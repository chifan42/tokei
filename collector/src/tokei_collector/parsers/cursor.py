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
CURSOR_DASHBOARD_API = "https://cursor.com/api/dashboard/get-filtered-usage-events"


class CursorParser:
    tool_name = "cursor"

    def scan(self, ctx: ParserContext, watermark: dict[str, Any]) -> Iterator[Event]:
        db_path = _find_cursor_db(ctx.home)

        # Phase 1: historical local bubbles
        if db_path is not None:
            yield from _scan_local_bubbles(db_path, watermark)

        # Phase 2: dashboard API for per-request usage events (much better than /auth/usage)
        dashboard_token = ctx.cursor_dashboard_token
        if dashboard_token:
            yield from _scan_dashboard_events(dashboard_token, watermark)


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



def _scan_dashboard_events(dashboard_token: str, watermark: dict[str, Any]) -> Iterator[Event]:
    """Fetch per-request usage events from Cursor's dashboard API.

    This gives exact timestamps, real model names, and full token breakdowns
    (input/output/cache_read/cache_write) per API call. Paginated.
    """
    seen_ts: set[str] = set(cast(list[str], watermark.setdefault("dashboard_seen", [])))
    last_ts: str = cast(str, watermark.get("dashboard_last_ts", "0"))

    # Fetch events from last known timestamp to now
    start_ms = last_ts if last_ts != "0" else str(int((time.time() - 30 * 86400) * 1000))
    end_ms = str(int(time.time() * 1000))

    max_ts_seen = last_ts
    page = 1
    new_events: list[Event] = []

    while True:
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(
                    CURSOR_DASHBOARD_API,
                    json={
                        "teamId": 0,
                        "startDate": start_ms,
                        "endDate": end_ms,
                        "page": page,
                        "pageSize": 100,
                    },
                    cookies={"WorkosCursorSessionToken": dashboard_token},
                    headers={"Content-Type": "application/json"},
                )
            if resp.status_code != 200:
                break
            data = resp.json()
        except (httpx.HTTPError, json.JSONDecodeError):
            break

        if not isinstance(data, dict):
            break

        resp_data = cast(dict[str, Any], data)
        events_list = resp_data.get("usageEventsDisplay", [])
        if not isinstance(events_list, list) or not events_list:
            break

        total_raw = resp_data.get("totalUsageEventsCount", 0)
        total = int(total_raw) if isinstance(total_raw, int | float) else 0

        for ev_entry in cast(list[Any], events_list):
            if not isinstance(ev_entry, dict):
                continue
            ev = cast(dict[str, Any], ev_entry)
            ts_ms = ev.get("timestamp")
            if not isinstance(ts_ms, str):
                continue

            event_key = f"{ts_ms}-{ev.get('model','')}"
            if event_key in seen_ts:
                continue

            token_usage = ev.get("tokenUsage")
            if not isinstance(token_usage, dict):
                continue
            tu = cast(dict[str, Any], token_usage)

            ts_sec = int(int(ts_ms) // 1000)
            model = ev.get("model")
            model_str = str(model) if isinstance(model, str) and model else None

            new_events.append(Event(
                tool="cursor",
                event_uuid=f"cursor-dash-{ts_ms}",
                ts=ts_sec,
                model=model_str,
                input_tokens=int(tu.get("inputTokens", 0) or 0),
                output_tokens=int(tu.get("outputTokens", 0) or 0),
                cached_input_tokens=int(tu.get("cacheReadTokens", 0) or 0),
                cache_creation_tokens=int(tu.get("cacheWriteTokens", 0) or 0),
            ))
            seen_ts.add(event_key)
            if ts_ms > max_ts_seen:
                max_ts_seen = ts_ms

        if page * 100 >= total:
            break
        page += 1

    watermark["dashboard_seen"] = sorted(seen_ts)
    watermark["dashboard_last_ts"] = max_ts_seen

    yield from new_events



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
