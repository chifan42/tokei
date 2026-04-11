"""Parse Gemini CLI OTLP telemetry log (line-delimited JSON records).

Gemini CLI writes OTLP log records via FileLogExporter. Each record is one JSON
document per line (or may span multiple lines as pretty-printed JSON in some
versions). This parser accepts line-delimited compact JSON; if future Gemini
versions emit pretty-printed multi-line records, extend the reader to handle
object boundaries.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any, cast

from ..models import Event
from .base import ParserContext

API_EVENT_NAME = "gemini_cli.api_response"


class GeminiParser:
    tool_name = "gemini"

    def scan(self, ctx: ParserContext, watermark: dict[str, Any]) -> Iterator[Event]:
        log_path = ctx.gemini_outfile
        if log_path is None or not log_path.exists():
            return

        start_offset = int(watermark.get("offset", 0))
        try:
            fsize = log_path.stat().st_size
        except OSError:
            return

        if fsize < start_offset:
            start_offset = 0

        with log_path.open("rb") as f:
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
                event = _extract_event(cast(dict[str, Any], obj))
                if event is not None:
                    yield event
            watermark["offset"] = f.tell()


def _extract_event(obj: dict[str, Any]) -> Event | None:
    body_raw = obj.get("body")
    if not isinstance(body_raw, dict):
        return None
    body = cast(dict[str, Any], body_raw)
    if body.get("event.name") != API_EVENT_NAME:
        return None

    request_id = body.get("request_id")
    if not isinstance(request_id, str) or not request_id:
        return None

    model_raw = body.get("model")
    model = str(model_raw) if isinstance(model_raw, str) else None

    time_nano_raw = obj.get("timeUnixNano")
    ts = 0
    if isinstance(time_nano_raw, str):
        try:
            ts = int(int(time_nano_raw) // 1_000_000_000)
        except ValueError:
            ts = 0
    elif isinstance(time_nano_raw, int | float):
        ts = int(time_nano_raw // 1_000_000_000)

    return Event(
        tool="gemini",
        event_uuid=request_id,
        ts=ts,
        model=model,
        input_tokens=int(body.get("input_token_count", 0) or 0),
        output_tokens=int(body.get("output_token_count", 0) or 0),
        cached_input_tokens=int(body.get("cached_content_token_count", 0) or 0),
        cache_creation_tokens=0,
        reasoning_output_tokens=int(body.get("thoughts_token_count", 0) or 0),
    )
