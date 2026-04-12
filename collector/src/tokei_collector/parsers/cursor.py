"""Parse Cursor token usage from local bubbles (historical) and server API (recent).

Historical data (_v=2 and early _v=3 bubbles with inline tokenCount) is read
from the local state.vscdb SQLite file. Recent data (Jan 2026+, where Cursor
stopped populating bubble tokenCount) is fetched from the Cursor server API
at api2.cursor.sh/auth/usage, which returns per-model monthly aggregates.

The server API approach: each collector run fetches the current month aggregate,
diffs against the watermark, and emits the delta as new events. The watermark
stores `{model: numTokens}` from the previous run.
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any, cast

import httpx

from ..models import Event
from .base import ParserContext

CURSOR_PATHS = [
    "Library/Application Support/Cursor/User/globalStorage/state.vscdb",  # macOS
    ".config/Cursor/User/globalStorage/state.vscdb",                       # Linux
]
CURSOR_USAGE_API = "https://api2.cursor.sh/auth/usage"


class CursorParser:
    tool_name = "cursor"

    def scan(self, ctx: ParserContext, watermark: dict[str, Any]) -> Iterator[Event]:
        db_path = _find_cursor_db(ctx.home)
        if db_path is None:
            return

        # Phase 1: historical local bubbles (same as before)
        yield from _scan_local_bubbles(db_path, watermark)

        # Phase 2: server API for recent data
        access_token = _read_access_token(db_path)
        if access_token:
            yield from _scan_api_usage(access_token, watermark)


def _find_cursor_db(home: Path) -> Path | None:
    for rel in CURSOR_PATHS:
        p = home / rel
        if p.exists():
            return p
    return None


def _build_composer_ts_map(conn: sqlite3.Connection) -> dict[str, int]:
    """Build bubbleId → unix timestamp from composerData's lastUpdatedAt/createdAt."""
    bubble_ts: dict[str, int] = {}
    cur = conn.execute("SELECT value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
    for (raw,) in cur:
        text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
        try:
            c = json.loads(text)
        except json.JSONDecodeError:
            continue
        ts_ms = c.get("lastUpdatedAt") or c.get("createdAt")
        if not isinstance(ts_ms, int | float) or ts_ms < _MIN_VALID_TS * 1000:
            continue
        headers = c.get("fullConversationHeadersOnly", [])
        if not isinstance(headers, list):
            continue
        for h_raw in cast(list[Any], headers):
            if isinstance(h_raw, dict):
                h_obj = cast(dict[str, Any], h_raw)
                bid = h_obj.get("bubbleId")
                if isinstance(bid, str) and bid:
                    bubble_ts[bid] = int(ts_ms // 1000)
    return bubble_ts


def _scan_local_bubbles(db_path: Any, watermark: dict[str, Any]) -> Iterator[Event]:
    seen_uuids: set[str] = set(cast(list[str], watermark.setdefault("seen_uuids", [])))

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return

    try:
        composer_ts = _build_composer_ts_map(conn)
        cursor = conn.execute("SELECT value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
        for (raw,) in cursor:
            text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
            try:
                obj = json.loads(text)
            except json.JSONDecodeError:
                continue
            event = _extract_bubble_event(cast(dict[str, Any], obj), seen_uuids, composer_ts)
            if event is not None:
                seen_uuids.add(event.event_uuid)
                yield event
    finally:
        conn.close()

    watermark["seen_uuids"] = sorted(seen_uuids)


def _read_access_token(db_path: Any) -> str | None:
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = conn.execute("SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken'")
        row = cur.fetchone()
        conn.close()
        if row and isinstance(row[0], str) and row[0]:
            return row[0]
    except sqlite3.Error:
        pass
    return None


def _scan_api_usage(access_token: str, watermark: dict[str, Any]) -> Iterator[Event]:
    api_wm: dict[str, int] = cast(dict[str, int], watermark.setdefault("api_usage", {}))
    api_month: str = cast(str, watermark.get("api_month", ""))
    first_run = len(api_wm) == 0 and not api_month

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(
                CURSOR_USAGE_API,
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if resp.status_code != 200:
            return
        data = resp.json()
    except (httpx.HTTPError, json.JSONDecodeError):
        return

    if not isinstance(data, dict):
        return

    usage: dict[str, Any] = cast(dict[str, Any], data)
    start_raw = usage.get("startOfMonth")
    current_month = str(start_raw) if isinstance(start_raw, str) else ""

    if current_month and current_month != api_month:
        api_wm.clear()
        watermark["api_month"] = current_month

    now = int(time.time())
    for model_key in list(usage.keys()):
        if model_key == "startOfMonth":
            continue
        info = usage[model_key]
        if not isinstance(info, dict):
            continue
        model_info = cast(dict[str, Any], info)
        num_tokens_raw = model_info.get("numTokens")
        if not isinstance(num_tokens_raw, int | float) or num_tokens_raw <= 0:
            continue

        num_tokens = int(num_tokens_raw)
        prev = api_wm.get(model_key, 0)
        api_wm[model_key] = num_tokens

        if first_run:
            # First run: record baseline without emitting events.
            # Otherwise the entire billing-period aggregate (potentially
            # millions of tokens) would appear as "today" usage.
            continue

        if num_tokens <= prev:
            continue

        delta = num_tokens - prev
        input_est = delta * 2 // 3
        output_est = delta - input_est

        yield Event(
            tool="cursor",
            event_uuid=f"cursor-api-{model_key}-{now}",
            ts=now,
            model=f"cursor-sub/{model_key}",
            input_tokens=input_est,
            output_tokens=output_est,
        )


def _extract_bubble_event(
    obj: dict[str, Any], seen: set[str], composer_ts: dict[str, int] | None = None
) -> Event | None:
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
    # Fall back to composerData's lastUpdatedAt/createdAt
    if ts is None and composer_ts is not None:
        bubble_id = obj.get("bubbleId")
        if isinstance(bubble_id, str) and bubble_id in composer_ts:
            ts = composer_ts[bubble_id]
    if ts is None:
        return None

    model = _extract_model(obj)

    return Event(
        tool="cursor",
        event_uuid=usage_uuid,
        ts=ts,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


_MIN_VALID_TS = 1577836800


def _extract_ts(obj: dict[str, Any]) -> int | None:
    timing_raw = obj.get("timingInfo")
    if isinstance(timing_raw, dict):
        timing = cast(dict[str, Any], timing_raw)
        end_ms = timing.get("clientEndTime")
        if isinstance(end_ms, int | float) and end_ms > 0:
            ts = int(end_ms / 1000)
            if ts >= _MIN_VALID_TS:
                return ts

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
