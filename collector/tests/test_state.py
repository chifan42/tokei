from pathlib import Path

from tokei_collector.state import State, load_state


def test_load_missing_returns_empty(tmp_path: Path):
    p = tmp_path / "state.json"
    s = load_state(p)
    assert s.watermarks == {}
    assert s.path == p


def test_roundtrip(tmp_path: Path):
    p = tmp_path / "state.json"
    s = State(path=p, watermarks={"claude_code": {"offset": 1234}})
    s.save()

    s2 = load_state(p)
    assert s2.watermarks == {"claude_code": {"offset": 1234}}


def test_corrupt_json_backs_up_and_returns_empty(tmp_path: Path):
    p = tmp_path / "state.json"
    p.write_text("{not valid json")
    s = load_state(p)
    assert s.watermarks == {}
    # Backup file should exist
    backups = list(tmp_path.glob("state.json.bak.*"))
    assert len(backups) == 1


def test_get_set_watermark(tmp_path: Path):
    p = tmp_path / "state.json"
    s = State(path=p, watermarks={})
    s.set("claude_code", {"offset": 42})
    assert s.get("claude_code") == {"offset": 42}
    assert s.get("codex") == {}
