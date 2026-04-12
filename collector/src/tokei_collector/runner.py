"""End-to-end run loop: scan enabled parsers, upload events, save watermark."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from .config import Config
from .errlog import log_error
from .models import Event
from .parsers.base import Parser, ParserContext
from .parsers.claude_code import ClaudeCodeParser
from .parsers.codex import CodexParser
from .parsers.cursor import CursorParser
from .parsers.gemini import GeminiParser
from .state import load_state
from .uploader import HttpError, Uploader

PARSER_REGISTRY: dict[str, Callable[[], Parser]] = {
    "claude_code": ClaudeCodeParser,
    "codex": CodexParser,
    "cursor": CursorParser,
    "gemini": GeminiParser,
}


@dataclass
class ParserResult:
    event_count: int
    error: str | None = None


@dataclass
class RunSummary:
    total_uploaded: int
    total_deduped: int
    parser_results: dict[str, ParserResult] = field(
        default_factory=lambda: cast(dict[str, "ParserResult"], {})
    )
    errors: list[str] = field(default_factory=lambda: cast(list[str], []))
    last_success_ts: int = 0


def run_once(
    cfg: Config,
    *,
    state_path: Path,
    home: Path | None = None,
    retry_sleep: Callable[[float], None] = time.sleep,
) -> RunSummary:
    home = home or Path.home()
    ctx = ParserContext(
        home=home,
        gemini_outfile=cfg.gemini_outfile,
        cursor_dashboard_token=cfg.cursor_dashboard_token,
    )

    state = load_state(state_path)
    summary = RunSummary(total_uploaded=0, total_deduped=0)

    collected: list[Event] = []
    updated_watermarks: dict[str, dict[str, Any]] = {}

    for name in cfg.enabled_parsers:
        factory = PARSER_REGISTRY.get(name)
        if factory is None:
            continue
        parser = factory()
        wm = dict(state.get(name))
        try:
            events = list(parser.scan(ctx, wm))
        except Exception as e:
            log_error(f"parser {name} crashed", exc=e)
            summary.parser_results[name] = ParserResult(
                event_count=0, error=f"{type(e).__name__}: {e}"
            )
            summary.errors.append(f"{name}: {e}")
            continue
        summary.parser_results[name] = ParserResult(event_count=len(events))
        collected.extend(events)
        updated_watermarks[name] = wm

    if not collected:
        summary.last_success_ts = int(time.time())
        for name, wm in updated_watermarks.items():
            state.set(name, wm)
        state.save()
        return summary

    uploader = Uploader(cfg.worker_url, cfg.bearer_token, cfg.device_id, retry_sleep=retry_sleep)
    try:
        result = uploader.upload(collected)
    except HttpError as e:
        log_error(f"upload failed: {e}", exc=e)
        summary.errors.append(f"upload: {e}")
        return summary

    summary.total_uploaded = result.accepted
    summary.total_deduped = result.deduped
    summary.last_success_ts = int(time.time())

    for name, wm in updated_watermarks.items():
        state.set(name, wm)
    state.save()
    return summary
