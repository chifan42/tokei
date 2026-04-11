"""Parse Claude Code session JSONL files under ~/.claude/projects/<proj>/<session>.jsonl."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime
from typing import Any, cast

from ..models import Event
from .base import ParserContext


class ClaudeCodeParser:
    tool_name = "claude_code"

    def scan(
        self, ctx: ParserContext, watermark: dict[str, Any]
    ) -> Iterator[Event]:
        projects = ctx.home / ".claude" / "projects"
        if not projects.exists():
            return

        file_offsets: dict[str, int] = watermark.setdefault("file_offsets", {})  # type: ignore[assignment]

        for jsonl_path in sorted(projects.rglob("*.jsonl")):
            rel_key = str(jsonl_path.relative_to(projects))
            start_offset = int(file_offsets.get(rel_key, 0))

            try:
                fsize = jsonl_path.stat().st_size
            except OSError:
                continue
            if fsize < start_offset:
                start_offset = 0

            with jsonl_path.open("rb") as f:
                f.seek(start_offset)
                while True:
                    line_start = f.tell()
                    raw = f.readline()
                    if not raw:
                        break
                    if not raw.endswith(b"\n"):
                        f.seek(line_start)
                        break
                    try:
                        obj = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    event = _extract_assistant_event(obj)
                    if event is not None:
                        yield event

                file_offsets[rel_key] = f.tell()


def _extract_assistant_event(obj: dict[str, Any]) -> Event | None:
    if obj.get("type") != "assistant":
        return None
    message_raw = obj.get("message")
    if not isinstance(message_raw, dict):
        return None
    message = cast(dict[str, Any], message_raw)
    usage_raw = message.get("usage")
    if not isinstance(usage_raw, dict):
        return None
    usage = cast(dict[str, Any], usage_raw)

    uuid = obj.get("uuid")
    if not isinstance(uuid, str) or not uuid:
        return None

    ts_raw = obj.get("timestamp")
    if isinstance(ts_raw, str):
        try:
            ts = int(datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).timestamp())
        except ValueError:
            ts = 0
    else:
        ts = 0

    model_raw = message.get("model")
    model = str(model_raw) if isinstance(model_raw, str) else None

    return Event(
        tool="claude_code",
        event_uuid=uuid,
        ts=ts,
        model=model,
        input_tokens=int(usage.get("input_tokens", 0) or 0),
        output_tokens=int(usage.get("output_tokens", 0) or 0),
        cached_input_tokens=int(usage.get("cache_read_input_tokens", 0) or 0),
        cache_creation_tokens=int(usage.get("cache_creation_input_tokens", 0) or 0),
        reasoning_output_tokens=0,
    )
