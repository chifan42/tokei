"""Parse Codex CLI session rollout JSONL under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime
from typing import Any, cast

from ..models import Event
from .base import ParserContext


class CodexParser:
    tool_name = "codex"

    def scan(self, ctx: ParserContext, watermark: dict[str, Any]) -> Iterator[Event]:
        sessions = ctx.home / ".codex" / "sessions"
        if not sessions.exists():
            return

        processed: dict[str, int] = watermark.setdefault("processed_events", {})  # type: ignore[assignment]

        for rollout in sorted(sessions.rglob("rollout-*.jsonl")):
            rel_key = str(rollout.relative_to(sessions))
            last_index = int(processed.get(rel_key, -1))

            session_id: str | None = None
            current_index = -1

            try:
                with rollout.open("r", encoding="utf-8") as f:
                    for raw in f:
                        try:
                            obj = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        typ = obj.get("type")
                        payload_raw = obj.get("payload")
                        if not isinstance(payload_raw, dict):
                            continue
                        payload = cast(dict[str, Any], payload_raw)

                        if typ == "session_meta" and session_id is None:
                            sid = payload.get("id")
                            if isinstance(sid, str):
                                session_id = sid

                        if typ != "event_msg":
                            continue
                        if payload.get("type") != "token_count":
                            continue
                        info_raw = payload.get("info")
                        if not isinstance(info_raw, dict):
                            continue
                        info = cast(dict[str, Any], info_raw)
                        last_usage_raw = info.get("last_token_usage")
                        if not isinstance(last_usage_raw, dict):
                            continue
                        last_usage = cast(dict[str, Any], last_usage_raw)

                        current_index += 1
                        if current_index <= last_index:
                            continue
                        if session_id is None:
                            continue

                        yield _event_from(obj, session_id, current_index, last_usage)

            except OSError:
                continue

            if current_index >= 0:
                processed[rel_key] = current_index


def _event_from(
    obj: dict[str, Any],
    session_id: str,
    index: int,
    last_usage: dict[str, Any],
) -> Event:
    ts_raw = obj.get("timestamp")
    ts = 0
    if isinstance(ts_raw, str):
        try:
            ts = int(datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).timestamp())
        except ValueError:
            ts = 0

    # OpenAI/Codex: input_tokens ALREADY includes cached_input_tokens.
    # Don't emit cached separately or the worker double-counts them.
    raw_input = int(last_usage.get("input_tokens", 0) or 0)
    raw_cached = int(last_usage.get("cached_input_tokens", 0) or 0)
    return Event(
        tool="codex",
        event_uuid=f"{session_id}:{index}",
        ts=ts,
        model=None,
        input_tokens=raw_input - raw_cached,
        output_tokens=int(last_usage.get("output_tokens", 0) or 0),
        cached_input_tokens=raw_cached,
        cache_creation_tokens=0,
        reasoning_output_tokens=int(last_usage.get("reasoning_output_tokens", 0) or 0),
    )
