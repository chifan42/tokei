"""Shared event fixtures consumed by both collector and worker.

Parses every file in fixtures/events/*.json, asserts our Event dataclass
can ingest them and round-trips to the same JSON shape (modulo default
field normalization).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tokei_collector.models import Event

FIXTURES_DIR = Path(__file__).parent.parent.parent / "fixtures" / "events"

REQUIRED_FIELDS = {
    "tool",
    "event_uuid",
    "ts",
    "model",
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
    "cache_creation_tokens",
    "reasoning_output_tokens",
}


@pytest.mark.parametrize("fixture_file", sorted(FIXTURES_DIR.glob("*.json")))
def test_fixture_parses_into_event(fixture_file: Path):
    with fixture_file.open() as f:
        data = json.load(f)

    event = Event(
        tool=data["tool"],
        event_uuid=data["event_uuid"],
        ts=data["ts"],
        model=data.get("model"),
        input_tokens=data["input_tokens"],
        output_tokens=data["output_tokens"],
        cached_input_tokens=data.get("cached_input_tokens", 0),
        cache_creation_tokens=data.get("cache_creation_tokens", 0),
        reasoning_output_tokens=data.get("reasoning_output_tokens", 0),
    )

    round_tripped = event.to_dict()
    assert set(round_tripped.keys()) == REQUIRED_FIELDS
    assert round_tripped["tool"] == data["tool"]
    assert round_tripped["event_uuid"] == data["event_uuid"]
