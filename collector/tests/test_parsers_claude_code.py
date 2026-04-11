from __future__ import annotations

import shutil
from pathlib import Path

from tokei_collector.parsers.base import ParserContext
from tokei_collector.parsers.claude_code import ClaudeCodeParser

FIXTURE = Path(__file__).parent / "fixtures" / "claude_code" / "session_sample.jsonl"


def setup_cc_home(tmp_path: Path) -> Path:
    proj_dir = tmp_path / ".claude" / "projects" / "test_proj"
    proj_dir.mkdir(parents=True)
    dest = proj_dir / "session-1.jsonl"
    shutil.copy(FIXTURE, dest)
    return tmp_path


def test_parses_assistant_messages_with_usage(tmp_path: Path):
    home = setup_cc_home(tmp_path)
    ctx = ParserContext(home=home)
    parser = ClaudeCodeParser()

    watermark: dict[str, object] = {}
    events = list(parser.scan(ctx, watermark))

    assert len(events) == 2
    assert events[0].tool == "claude_code"
    assert events[0].event_uuid == "22222222-2222-2222-2222-222222222222"
    assert events[0].model == "claude-sonnet-4-5"
    assert events[0].input_tokens == 1200
    assert events[0].output_tokens == 20
    assert events[0].cached_input_tokens == 800
    assert events[0].cache_creation_tokens == 0
    assert events[1].event_uuid == "33333333-3333-3333-3333-333333333333"
    assert events[1].model == "claude-opus-4-6"
    assert events[1].cache_creation_tokens == 500


def test_skips_user_messages(tmp_path: Path):
    home = setup_cc_home(tmp_path)
    ctx = ParserContext(home=home)
    parser = ClaudeCodeParser()
    events = list(parser.scan(ctx, {}))
    assert all(e.tool == "claude_code" for e in events)
    assert len(events) == 2  # only the 2 assistant msgs, not the user msg


def test_watermark_advances_and_skips_on_second_run(tmp_path: Path):
    home = setup_cc_home(tmp_path)
    ctx = ParserContext(home=home)
    parser = ClaudeCodeParser()

    wm: dict[str, object] = {}
    first = list(parser.scan(ctx, wm))
    assert len(first) == 2

    # Second run with the advanced watermark should yield nothing new
    second = list(parser.scan(ctx, wm))
    assert len(second) == 0


def test_picks_up_new_lines_appended(tmp_path: Path):
    home = setup_cc_home(tmp_path)
    ctx = ParserContext(home=home)
    parser = ClaudeCodeParser()
    wm: dict[str, object] = {}
    list(parser.scan(ctx, wm))

    # Append a new assistant message
    session = home / ".claude" / "projects" / "test_proj" / "session-1.jsonl"
    new_line = (
        '{"type":"assistant","uuid":"44444444-4444-4444-4444-444444444444",'
        '"message":{"role":"assistant","model":"claude-sonnet-4-5","usage":{"input_tokens":500,"output_tokens":30}},'
        '"timestamp":"2026-04-12T10:01:00Z"}'
    )
    with session.open("a") as f:
        f.write(new_line + "\n")

    new_events = list(parser.scan(ctx, wm))
    assert len(new_events) == 1
    assert new_events[0].event_uuid == "44444444-4444-4444-4444-444444444444"


def test_handles_missing_projects_dir(tmp_path: Path):
    # ~/.claude/ does not exist; parser should yield nothing, not crash
    ctx = ParserContext(home=tmp_path)
    parser = ClaudeCodeParser()
    events = list(parser.scan(ctx, {}))
    assert events == []
