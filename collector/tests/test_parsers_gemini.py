from __future__ import annotations

import shutil
from pathlib import Path

from tokei_collector.parsers.base import ParserContext
from tokei_collector.parsers.gemini import GeminiParser

FIXTURE = Path(__file__).parent / "fixtures" / "gemini" / "telemetry_sample.log"


def setup_gemini(tmp_path: Path) -> Path:
    log = tmp_path / "telemetry.log"
    shutil.copy(FIXTURE, log)
    return log


def test_parses_api_response_events(tmp_path: Path):
    log = setup_gemini(tmp_path)
    ctx = ParserContext(home=tmp_path, gemini_outfile=log)
    parser = GeminiParser()

    events = list(parser.scan(ctx, {}))
    assert len(events) == 2
    assert events[0].tool == "gemini"
    assert events[0].event_uuid == "req-1"
    assert events[0].model == "gemini-2.5-pro"
    assert events[0].input_tokens == 5000
    assert events[0].output_tokens == 800
    assert events[0].cached_input_tokens == 1000
    assert events[0].reasoning_output_tokens == 120
    assert events[1].event_uuid == "req-2"


def test_skips_non_api_events(tmp_path: Path):
    log = setup_gemini(tmp_path)
    ctx = ParserContext(home=tmp_path, gemini_outfile=log)
    parser = GeminiParser()
    events = list(parser.scan(ctx, {}))
    assert all(e.tool == "gemini" for e in events)
    assert len(events) == 2


def test_watermark_advances_file_offset(tmp_path: Path):
    log = setup_gemini(tmp_path)
    ctx = ParserContext(home=tmp_path, gemini_outfile=log)
    parser = GeminiParser()
    wm: dict[str, object] = {}
    first = list(parser.scan(ctx, wm))
    assert len(first) == 2
    second = list(parser.scan(ctx, wm))
    assert second == []


def test_no_outfile_configured_returns_empty(tmp_path: Path):
    ctx = ParserContext(home=tmp_path, gemini_outfile=None)
    parser = GeminiParser()
    assert list(parser.scan(ctx, {})) == []


def test_outfile_missing_returns_empty(tmp_path: Path):
    ctx = ParserContext(home=tmp_path, gemini_outfile=tmp_path / "missing.log")
    parser = GeminiParser()
    assert list(parser.scan(ctx, {})) == []
