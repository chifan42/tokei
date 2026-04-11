from tokei_collector.models import Event


def test_event_to_dict_has_all_required_fields():
    e = Event(
        tool="claude_code",
        event_uuid="abc-123",
        ts=1744370000,
        model="claude-sonnet-4-5",
        input_tokens=100,
        output_tokens=50,
    )
    d = e.to_dict()
    assert d["tool"] == "claude_code"
    assert d["event_uuid"] == "abc-123"
    assert d["ts"] == 1744370000
    assert d["model"] == "claude-sonnet-4-5"
    assert d["input_tokens"] == 100
    assert d["output_tokens"] == 50
    assert d["cached_input_tokens"] == 0
    assert d["cache_creation_tokens"] == 0
    assert d["reasoning_output_tokens"] == 0


def test_event_to_dict_null_model():
    e = Event(
        tool="cursor",
        event_uuid="abc-123",
        ts=1744370000,
        model=None,
        input_tokens=100,
        output_tokens=50,
    )
    d = e.to_dict()
    assert d["model"] is None


def test_event_frozen():
    e = Event(
        tool="claude_code",
        event_uuid="abc",
        ts=0,
        model=None,
        input_tokens=0,
        output_tokens=0,
    )
    import dataclasses
    with __import__("pytest").raises(dataclasses.FrozenInstanceError):
        e.tool = "cursor"  # type: ignore[misc]
