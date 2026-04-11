"""Parse Cursor state.vscdb bubbleId:* blobs for token usage."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from datetime import datetime
from typing import Any, cast

from ..models import Event
from .base import ParserContext

CURSOR_GLOBAL_STORAGE = "Library/Application Support/Cursor/User/globalStorage/state.vscdb"


class CursorParser:
    tool_name = "cursor"

    def scan(self, ctx: ParserContext, watermark: dict[str, Any]) -> Iterator[Event]:
        db_path = ctx.home / CURSOR_GLOBAL_STORAGE
        if not db_path.exists():
            return

        seen_uuids: set[str] = set(cast(list[str], watermark.setdefault("seen_uuids", [])))

        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        except sqlite3.Error:
            return

        try:
            cursor = conn.execute("SELECT value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
            for (raw,) in cursor:
                text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
                try:
                    obj = json.loads(text)
                except json.JSONDecodeError:
                    continue
                event = _extract_event(cast(dict[str, Any], obj), seen_uuids)
                if event is not None:
                    seen_uuids.add(event.event_uuid)
                    yield event
        finally:
            conn.close()

        watermark["seen_uuids"] = sorted(seen_uuids)


def _extract_event(obj: dict[str, Any], seen: set[str]) -> Event | None:
    token_count_raw = obj.get("tokenCount")
    if not isinstance(token_count_raw, dict):
        return None
    token_count = cast(dict[str, Any], token_count_raw)
    input_tokens = int(token_count.get("inputTokens", 0) or 0)
    output_tokens = int(token_count.get("outputTokens", 0) or 0)
    if input_tokens == 0 and output_tokens == 0:
        return None

    usage_uuid = obj.get("usageUuid")
    if not isinstance(usage_uuid, str) or not usage_uuid:
        return None
    if usage_uuid in seen:
        return None

    ts = _extract_ts(obj)
    if ts is None:
        # Skip bubbles we cannot date. Cursor's older schema (_v=2 without
        # timingInfo) and any blob with missing/corrupt timing leaves us with
        # no way to place the event in time, so aggregations would be wrong.
        return None

    model = _extract_model(obj)

    return Event(
        tool="cursor",
        event_uuid=usage_uuid,
        ts=ts,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cached_input_tokens=0,
        cache_creation_tokens=0,
        reasoning_output_tokens=0,
    )


_MIN_VALID_TS = 1577836800  # 2020-01-01 UTC. Anything older is a parse artifact.


def _extract_ts(obj: dict[str, Any]) -> int | None:
    timing_raw = obj.get("timingInfo")
    if isinstance(timing_raw, dict):
        timing = cast(dict[str, Any], timing_raw)
        end_ms = timing.get("clientEndTime")
        if isinstance(end_ms, int | float) and end_ms > 0:
            ts = int(end_ms / 1000)
            if ts >= _MIN_VALID_TS:
                return ts

    # Cursor _v=3 bubbles include a createdAt ISO string; fall back to it if
    # timingInfo is absent or invalid.
    created_raw = obj.get("createdAt")
    if isinstance(created_raw, str) and created_raw:
        try:
            parsed = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
            ts = int(parsed.timestamp())
            if ts >= _MIN_VALID_TS:
                return ts
        except ValueError:
            pass

    return None


def _extract_model(obj: dict[str, Any]) -> str | None:
    model_info = obj.get("modelInfo")
    if isinstance(model_info, dict):
        name = cast(dict[str, Any], model_info).get("modelName")
        if isinstance(name, str) and name:
            return name
    return None
