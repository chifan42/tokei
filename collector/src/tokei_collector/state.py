"""Watermark state persisted to ~/.tokei/state.json."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast


class StateError(Exception):
    pass


@dataclass
class State:
    path: Path
    watermarks: dict[str, dict[str, Any]] = field(
        default_factory=lambda: cast(dict[str, dict[str, Any]], {})
    )

    def get(self, parser: str) -> dict[str, Any]:
        return self.watermarks.get(parser, {})

    def set(self, parser: str, wm: dict[str, Any]) -> None:
        self.watermarks[parser] = wm

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.watermarks, indent=2))
        tmp.replace(self.path)


def default_state_path() -> Path:
    return Path.home() / ".tokei" / "state.json"


def load_state(path: Path | None = None) -> State:
    path = path or default_state_path()
    if not path.exists():
        return State(path=path, watermarks={})

    text = path.read_text()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        backup = path.with_suffix(f".json.bak.{int(time.time())}")
        path.rename(backup)
        return State(path=path, watermarks={})

    if not isinstance(data, dict):
        raise StateError(f"State file {path} is not a JSON object")
    return State(path=path, watermarks=cast(dict[str, dict[str, Any]], data))
