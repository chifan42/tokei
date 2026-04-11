from __future__ import annotations

import shutil
from pathlib import Path

from tokei_collector.parsers.base import ParserContext
from tokei_collector.parsers.codex import CodexParser

FIXTURE = Path(__file__).parent / "fixtures" / "codex" / "rollout_sample.jsonl"


def setup_codex_home(tmp_path: Path) -> Path:
    day_dir = tmp_path / ".codex" / "sessions" / "2026" / "04" / "12"
    day_dir.mkdir(parents=True)
    shutil.copy(FIXTURE, day_dir / "rollout-2026-04-12T10-00-00-sess-1.jsonl")
    return tmp_path


def test_parses_token_count_events_as_deltas(tmp_path: Path):
    home = setup_codex_home(tmp_path)
    ctx = ParserContext(home=home)
    parser = CodexParser()

    events = list(parser.scan(ctx, {}))
    assert len(events) == 2
    # First event: delta equal to last_token_usage values
    assert events[0].event_uuid == "sess-1:0"
    assert events[0].input_tokens == 1000
    assert events[0].output_tokens == 100
    assert events[0].cached_input_tokens == 500
    assert events[0].reasoning_output_tokens == 50
    # Second event: delta from last_token_usage (not total)
    assert events[1].event_uuid == "sess-1:1"
    assert events[1].input_tokens == 1500
    assert events[1].output_tokens == 150
    assert events[1].cached_input_tokens == 700
    assert events[1].reasoning_output_tokens == 30


def test_watermark_skips_already_processed(tmp_path: Path):
    home = setup_codex_home(tmp_path)
    ctx = ParserContext(home=home)
    parser = CodexParser()
    wm: dict[str, object] = {}
    first = list(parser.scan(ctx, wm))
    assert len(first) == 2
    second = list(parser.scan(ctx, wm))
    assert second == []


def test_missing_codex_dir_returns_empty(tmp_path: Path):
    ctx = ParserContext(home=tmp_path)
    parser = CodexParser()
    assert list(parser.scan(ctx, {})) == []
