from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from tokei_collector.parsers.base import ParserContext
from tokei_collector.parsers.cursor import CursorParser


def _insert_bubble(
    db: Path,
    bubble_id: str,
    *,
    input_tokens: int,
    output_tokens: int,
    usage_uuid: str,
    client_end_time_ms: int,
) -> None:
    value = {
        "_v": 2,
        "type": 2,
        "bubbleId": bubble_id,
        "tokenCount": {"inputTokens": input_tokens, "outputTokens": output_tokens},
        "usageUuid": usage_uuid,
        "timingInfo": {"clientEndTime": client_end_time_ms},
    }
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)",
            (f"bubbleId:{bubble_id}", json.dumps(value)),
        )


def _setup_cursor_home(tmp_path: Path) -> Path:
    """Create ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb."""
    home = tmp_path
    global_dir = home / "Library" / "Application Support" / "Cursor" / "User" / "globalStorage"
    global_dir.mkdir(parents=True)
    db = global_dir / "state.vscdb"
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)")
    return home


def test_parses_bubbles_with_nonzero_tokens(tmp_path: Path):
    home = _setup_cursor_home(tmp_path)
    db = (
        home
        / "Library"
        / "Application Support"
        / "Cursor"
        / "User"
        / "globalStorage"
        / "state.vscdb"
    )
    _insert_bubble(
        db,
        "bub-1",
        input_tokens=27909,
        output_tokens=9129,
        usage_uuid="usage-1",
        client_end_time_ms=1744370000000,
    )
    _insert_bubble(
        db,
        "bub-2",
        input_tokens=1000,
        output_tokens=500,
        usage_uuid="usage-2",
        client_end_time_ms=1744370010000,
    )

    parser = CursorParser()
    ctx = ParserContext(home=home)
    events = list(parser.scan(ctx, {}))

    assert len(events) == 2
    events.sort(key=lambda e: e.event_uuid)
    assert events[0].event_uuid == "usage-1"
    assert events[0].input_tokens == 27909
    assert events[0].output_tokens == 9129
    assert events[0].ts == 1744370000
    assert events[0].model is None


def test_skips_bubbles_with_zero_tokens(tmp_path: Path):
    home = _setup_cursor_home(tmp_path)
    db = (
        home
        / "Library"
        / "Application Support"
        / "Cursor"
        / "User"
        / "globalStorage"
        / "state.vscdb"
    )
    _insert_bubble(
        db,
        "user-1",
        input_tokens=0,
        output_tokens=0,
        usage_uuid="usage-zero",
        client_end_time_ms=1744370000000,
    )
    _insert_bubble(
        db,
        "asst-1",
        input_tokens=500,
        output_tokens=200,
        usage_uuid="usage-real",
        client_end_time_ms=1744370000000,
    )

    parser = CursorParser()
    ctx = ParserContext(home=home)
    events = list(parser.scan(ctx, {}))
    assert len(events) == 1
    assert events[0].event_uuid == "usage-real"


def test_watermark_skips_previously_seen_usage_uuids(tmp_path: Path):
    home = _setup_cursor_home(tmp_path)
    db = (
        home
        / "Library"
        / "Application Support"
        / "Cursor"
        / "User"
        / "globalStorage"
        / "state.vscdb"
    )
    _insert_bubble(
        db,
        "b1",
        input_tokens=100,
        output_tokens=50,
        usage_uuid="u1",
        client_end_time_ms=1744370000000,
    )

    parser = CursorParser()
    ctx = ParserContext(home=home)
    wm: dict[str, object] = {}
    first = list(parser.scan(ctx, wm))
    assert len(first) == 1

    _insert_bubble(
        db,
        "b2",
        input_tokens=200,
        output_tokens=80,
        usage_uuid="u2",
        client_end_time_ms=1744370010000,
    )

    second = list(parser.scan(ctx, wm))
    assert len(second) == 1
    assert second[0].event_uuid == "u2"


def test_missing_cursor_db_returns_empty(tmp_path: Path):
    ctx = ParserContext(home=tmp_path)
    parser = CursorParser()
    assert list(parser.scan(ctx, {})) == []


def _insert_raw_bubble(db: Path, bubble_id: str, value: dict) -> None:
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)",
            (f"bubbleId:{bubble_id}", json.dumps(value)),
        )


def test_skips_bubbles_with_no_timing_and_no_created_at(tmp_path: Path):
    home = _setup_cursor_home(tmp_path)
    db = (
        home
        / "Library"
        / "Application Support"
        / "Cursor"
        / "User"
        / "globalStorage"
        / "state.vscdb"
    )
    _insert_raw_bubble(
        db,
        "no-ts",
        {
            "_v": 2,
            "type": 2,
            "bubbleId": "no-ts",
            "tokenCount": {"inputTokens": 500, "outputTokens": 100},
            "usageUuid": "usage-no-ts",
        },
    )

    parser = CursorParser()
    ctx = ParserContext(home=home)
    events = list(parser.scan(ctx, {}))
    assert events == []


def test_skips_bubbles_with_invalid_client_end_time(tmp_path: Path):
    home = _setup_cursor_home(tmp_path)
    db = (
        home
        / "Library"
        / "Application Support"
        / "Cursor"
        / "User"
        / "globalStorage"
        / "state.vscdb"
    )
    _insert_bubble(
        db,
        "zero-ts",
        input_tokens=100,
        output_tokens=50,
        usage_uuid="u-zero",
        client_end_time_ms=0,
    )

    parser = CursorParser()
    ctx = ParserContext(home=home)
    events = list(parser.scan(ctx, {}))
    assert events == []


def test_falls_back_to_created_at_when_timing_missing(tmp_path: Path):
    home = _setup_cursor_home(tmp_path)
    db = (
        home
        / "Library"
        / "Application Support"
        / "Cursor"
        / "User"
        / "globalStorage"
        / "state.vscdb"
    )
    _insert_raw_bubble(
        db,
        "created-only",
        {
            "_v": 3,
            "type": 2,
            "bubbleId": "created-only",
            "createdAt": "2026-04-10T12:34:56.789Z",
            "tokenCount": {"inputTokens": 1000, "outputTokens": 500},
            "usageUuid": "usage-created",
        },
    )

    parser = CursorParser()
    ctx = ParserContext(home=home)
    events = list(parser.scan(ctx, {}))
    assert len(events) == 1
    # 2026-04-10T12:34:56Z
    assert events[0].ts == 1775824496


def test_extracts_model_name_from_model_info(tmp_path: Path):
    home = _setup_cursor_home(tmp_path)
    db = (
        home
        / "Library"
        / "Application Support"
        / "Cursor"
        / "User"
        / "globalStorage"
        / "state.vscdb"
    )
    _insert_raw_bubble(
        db,
        "with-model",
        {
            "_v": 3,
            "type": 2,
            "bubbleId": "with-model",
            "modelInfo": {"modelName": "gpt-5.2-high"},
            "tokenCount": {"inputTokens": 200, "outputTokens": 80},
            "usageUuid": "usage-model",
            "timingInfo": {"clientEndTime": 1744370000000},
        },
    )

    parser = CursorParser()
    ctx = ParserContext(home=home)
    events = list(parser.scan(ctx, {}))
    assert len(events) == 1
    assert events[0].model == "gpt-5.2-high"
