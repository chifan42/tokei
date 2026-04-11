# Tokei Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python collector that parses local AI tool logs (Claude Code, Codex, Cursor, Gemini) and uploads token usage events to the Tokei Worker.

**Architecture:** Single Python package managed by uv with src layout. Four independent parser modules implementing a common `Parser` Protocol. A main loop iterates enabled parsers, collects Events, batches them into POST /v1/ingest calls, and advances per-parser watermarks only after successful upload. Failures preserve watermarks so the next run retries idempotently (worker dedups by event_uuid).

**Tech Stack:** Python 3.11+ · uv · src layout · ruff · pyright strict · httpx · stdlib `sqlite3` / `tomllib` / `argparse` · pytest + pytest-httpx

**Spec Reference:** `docs/superpowers/specs/2026-04-11-tokei-design.md`

**Worker API (already deployed):** `https://tokei-worker.chifan.workers.dev/v1/ingest` and `/v1/summary`, bearer-authed. Event shape is defined by the shared fixtures in `fixtures/events/*.json`.

**Scope:** This plan covers only the Collector subsystem. The Worker is already implemented and deployed. Firmware is a separate plan.

---

## File Structure

### Collector package

| Path | Responsibility |
|---|---|
| `collector/pyproject.toml` | uv project config, ruff, pyright, deps |
| `collector/README.md` | CLI reference + setup notes |
| `collector/src/tokei_collector/__init__.py` | Empty package marker |
| `collector/src/tokei_collector/__main__.py` | CLI entry (`python -m tokei_collector` or `tokei-collect`) |
| `collector/src/tokei_collector/models.py` | `Event` dataclass matching worker event schema |
| `collector/src/tokei_collector/config.py` | Load `~/.tokei/config.toml`, resolve bearer token env ref |
| `collector/src/tokei_collector/state.py` | Read/write `~/.tokei/state.json` watermarks |
| `collector/src/tokei_collector/uploader.py` | Batch POST `/v1/ingest` with exponential backoff retry |
| `collector/src/tokei_collector/runner.py` | Main run loop: enumerate parsers, collect, upload, save state |
| `collector/src/tokei_collector/errlog.py` | Append error log to `~/.tokei/error.log`, rotate at 1 MB |
| `collector/src/tokei_collector/doctor.py` | `doctor` subcommand: print state + last errors |
| `collector/src/tokei_collector/cli.py` | argparse setup for all subcommands |
| `collector/src/tokei_collector/installers.py` | Generate launchd plist / systemd unit files |
| `collector/src/tokei_collector/parsers/__init__.py` | Parser registry |
| `collector/src/tokei_collector/parsers/base.py` | `Parser` Protocol + `ParserContext` dataclass |
| `collector/src/tokei_collector/parsers/claude_code.py` | Claude Code JSONL parser |
| `collector/src/tokei_collector/parsers/codex.py` | Codex session rollout JSONL parser |
| `collector/src/tokei_collector/parsers/cursor.py` | Cursor SQLite state.vscdb parser |
| `collector/src/tokei_collector/parsers/gemini.py` | Gemini CLI OTLP log parser |
| `collector/deploy/com.tokei.collector.plist` | launchd template |
| `collector/deploy/tokei-collector.service` | systemd service template |
| `collector/deploy/tokei-collector.timer` | systemd timer template |
| `collector/tests/conftest.py` | pytest fixtures + tmp_path helpers |
| `collector/tests/test_models.py` | Event dataclass round-trip tests |
| `collector/tests/test_config.py` | Config loading tests |
| `collector/tests/test_state.py` | Watermark read/write tests |
| `collector/tests/test_uploader.py` | Uploader retry + batch tests (pytest-httpx) |
| `collector/tests/test_parsers_claude_code.py` | Claude Code parser tests |
| `collector/tests/test_parsers_codex.py` | Codex parser tests |
| `collector/tests/test_parsers_cursor.py` | Cursor parser tests |
| `collector/tests/test_parsers_gemini.py` | Gemini parser tests |
| `collector/tests/test_contract.py` | Shared fixtures contract test |
| `collector/tests/test_runner.py` | End-to-end runner test with mock worker |
| `collector/tests/fixtures/claude_code/session.jsonl` | Sample CC JSONL |
| `collector/tests/fixtures/codex/rollout.jsonl` | Sample Codex rollout |
| `collector/tests/fixtures/cursor/state.vscdb` | Generated empty Cursor SQLite DB |
| `collector/tests/fixtures/gemini/telemetry.log` | Sample OTLP log |

---

## Task 1: Scaffold collector Python package

**Files:**
- Create: `collector/pyproject.toml`
- Create: `collector/README.md`
- Create: `collector/src/tokei_collector/__init__.py`
- Create: `collector/.python-version`

- [ ] **Step 1: Run uv init for the package**

```bash
cd /Users/chichi/workspace/xx/tokei
mkdir -p collector/src/tokei_collector collector/tests collector/deploy
```

- [ ] **Step 2: Write pyproject.toml**

`collector/pyproject.toml`:

```toml
[project]
name = "tokei-collector"
version = "0.0.1"
description = "Tokei collector: scan local AI tool logs and upload token usage to the Tokei worker"
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "httpx>=0.27",
]

[project.scripts]
tokei-collect = "tokei_collector.__main__:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/tokei_collector"]

[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-httpx>=0.30",
    "ruff>=0.7",
    "pyright>=1.1.380",
]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "N", "W", "C4", "SIM", "RUF"]
ignore = ["E501"]  # let ruff format handle line length

[tool.ruff.format]
quote-style = "double"

[tool.pyright]
include = ["src", "tests"]
strict = ["src"]
pythonVersion = "3.11"
reportMissingImports = true
reportMissingTypeStubs = false

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
```

- [ ] **Step 3: Write .python-version**

`collector/.python-version`:

```
3.11
```

- [ ] **Step 4: Write collector/README.md**

```markdown
# Tokei Collector

Python collector that scans local AI tool logs (Claude Code, Codex, Cursor, Gemini CLI) and uploads token usage events to the Tokei Worker.

## Setup

```bash
cd collector
uv sync
uv run tokei-collect --init   # interactive config
uv run tokei-collect doctor   # check state
```

## Configuration

See `~/.tokei/config.toml`:

```toml
device_id = "my-mac"
worker_url = "https://tokei-worker.<subdomain>.workers.dev"
bearer_token = "env:TOKEI_TOKEN"

[parsers]
enabled = ["claude_code", "codex", "cursor", "gemini"]

[parsers.gemini]
outfile = "~/.gemini/telemetry.log"
```

## Install as timer

- **macOS:** `uv run tokei-collect install --launchd`
- **Linux:** `uv run tokei-collect install --systemd`
```

- [ ] **Step 5: Create empty package marker**

`collector/src/tokei_collector/__init__.py`:

```python
"""Tokei collector: parse local AI tool logs and upload token usage."""

__version__ = "0.0.1"
```

- [ ] **Step 6: Run uv sync to verify**

```bash
cd /Users/chichi/workspace/xx/tokei/collector
uv sync
```

Expected: `Resolved N packages ... Installed N packages`

- [ ] **Step 7: Commit**

```bash
cd /Users/chichi/workspace/xx/tokei
git add collector/ .gitignore
git commit -m "chore(collector): scaffold python package with uv src layout"
```

---

## Task 2: Event model

**Files:**
- Create: `collector/src/tokei_collector/models.py`
- Create: `collector/tests/test_models.py`

- [ ] **Step 1: Write failing test**

`collector/tests/test_models.py`:

```python
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
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd /Users/chichi/workspace/xx/tokei/collector && uv run pytest tests/test_models.py -v
```

Expected: FAIL with `ModuleNotFoundError: tokei_collector.models`.

- [ ] **Step 3: Implement Event dataclass**

`collector/src/tokei_collector/models.py`:

```python
"""Event dataclass matching the worker's eventSchema."""

from dataclasses import asdict, dataclass
from typing import Literal

ToolName = Literal["claude_code", "codex", "cursor", "gemini"]


@dataclass(frozen=True, slots=True)
class Event:
    tool: ToolName
    event_uuid: str
    ts: int
    model: str | None
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int = 0
    cache_creation_tokens: int = 0
    reasoning_output_tokens: int = 0

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
```

- [ ] **Step 4: Run test, expect pass**

```bash
cd /Users/chichi/workspace/xx/tokei/collector && uv run pytest tests/test_models.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Run ruff and pyright**

```bash
uv run ruff check src tests && uv run pyright src
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/chichi/workspace/xx/tokei
git add collector/src/tokei_collector/models.py collector/tests/test_models.py
git commit -m "feat(collector): event dataclass with to_dict serializer"
```

---

## Task 3: Config module

**Files:**
- Create: `collector/src/tokei_collector/config.py`
- Create: `collector/tests/test_config.py`

- [ ] **Step 1: Write failing test**

`collector/tests/test_config.py`:

```python
import os
from pathlib import Path
import pytest

from tokei_collector.config import Config, ConfigError, load_config


def write_toml(tmp_path: Path, content: str) -> Path:
    p = tmp_path / "config.toml"
    p.write_text(content)
    return p


def test_loads_valid_config(tmp_path: Path):
    p = write_toml(
        tmp_path,
        """
device_id = "my-mac"
worker_url = "https://tokei.example.workers.dev"
bearer_token = "literal-token-value"

[parsers]
enabled = ["claude_code", "codex"]
""",
    )
    cfg = load_config(p)
    assert cfg.device_id == "my-mac"
    assert cfg.worker_url == "https://tokei.example.workers.dev"
    assert cfg.bearer_token == "literal-token-value"
    assert cfg.enabled_parsers == ["claude_code", "codex"]


def test_env_token_ref(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    p = write_toml(
        tmp_path,
        """
device_id = "m"
worker_url = "https://x.workers.dev"
bearer_token = "env:TOKEI_TOKEN"

[parsers]
enabled = ["claude_code"]
""",
    )
    monkeypatch.setenv("TOKEI_TOKEN", "secret-from-env")
    cfg = load_config(p)
    assert cfg.bearer_token == "secret-from-env"


def test_env_token_missing_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    p = write_toml(
        tmp_path,
        """
device_id = "m"
worker_url = "https://x.workers.dev"
bearer_token = "env:MISSING_VAR"

[parsers]
enabled = ["claude_code"]
""",
    )
    monkeypatch.delenv("MISSING_VAR", raising=False)
    with pytest.raises(ConfigError, match="MISSING_VAR"):
        load_config(p)


def test_rejects_unknown_parser(tmp_path: Path):
    p = write_toml(
        tmp_path,
        """
device_id = "m"
worker_url = "https://x.workers.dev"
bearer_token = "t"

[parsers]
enabled = ["claude_code", "not_a_tool"]
""",
    )
    with pytest.raises(ConfigError, match="not_a_tool"):
        load_config(p)


def test_gemini_outfile_default_expands_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    p = write_toml(
        tmp_path,
        """
device_id = "m"
worker_url = "https://x.workers.dev"
bearer_token = "t"

[parsers]
enabled = ["gemini"]

[parsers.gemini]
outfile = "~/.gemini/telemetry.log"
""",
    )
    cfg = load_config(p)
    assert cfg.gemini_outfile == tmp_path / ".gemini" / "telemetry.log"
```

- [ ] **Step 2: Run test, expect failure**

```bash
uv run pytest tests/test_config.py -v
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement Config**

`collector/src/tokei_collector/config.py`:

```python
"""Load and validate ~/.tokei/config.toml."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import cast

KNOWN_PARSERS = {"claude_code", "codex", "cursor", "gemini"}


class ConfigError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class Config:
    device_id: str
    worker_url: str
    bearer_token: str
    enabled_parsers: list[str]
    gemini_outfile: Path | None
    config_path: Path


def default_config_path() -> Path:
    return Path.home() / ".tokei" / "config.toml"


def load_config(path: Path | None = None) -> Config:
    path = path or default_config_path()
    if not path.exists():
        raise ConfigError(f"Config file not found: {path}. Run 'tokei-collect --init'.")

    try:
        raw = tomllib.loads(path.read_text())
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(f"Invalid TOML in {path}: {e}") from e

    device_id = _require_str(raw, "device_id")
    worker_url = _require_str(raw, "worker_url")
    bearer_token_raw = _require_str(raw, "bearer_token")
    bearer_token = _resolve_token(bearer_token_raw)

    parsers = raw.get("parsers", {})
    if not isinstance(parsers, dict):
        raise ConfigError("[parsers] must be a table")
    enabled = parsers.get("enabled", [])
    if not isinstance(enabled, list) or not all(isinstance(x, str) for x in enabled):
        raise ConfigError("parsers.enabled must be a list of strings")
    unknown = [p for p in enabled if p not in KNOWN_PARSERS]
    if unknown:
        raise ConfigError(f"Unknown parser(s): {unknown}. Known: {sorted(KNOWN_PARSERS)}")

    gemini_outfile: Path | None = None
    gemini_section = parsers.get("gemini", {})
    if isinstance(gemini_section, dict):
        outfile_raw = gemini_section.get("outfile")
        if isinstance(outfile_raw, str):
            gemini_outfile = Path(outfile_raw).expanduser()

    return Config(
        device_id=device_id,
        worker_url=worker_url.rstrip("/"),
        bearer_token=bearer_token,
        enabled_parsers=cast(list[str], enabled),
        gemini_outfile=gemini_outfile,
        config_path=path,
    )


def _require_str(raw: dict[str, object], key: str) -> str:
    val = raw.get(key)
    if not isinstance(val, str) or not val:
        raise ConfigError(f"Missing or invalid '{key}' in config")
    return val


def _resolve_token(raw: str) -> str:
    if raw.startswith("env:"):
        var = raw[4:]
        val = os.environ.get(var)
        if not val:
            raise ConfigError(f"Env var '{var}' is not set (referenced by bearer_token)")
        return val
    return raw
```

- [ ] **Step 4: Run test, expect pass**

```bash
uv run pytest tests/test_config.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add collector/src/tokei_collector/config.py collector/tests/test_config.py
git commit -m "feat(collector): config loader with env token refs"
```

---

## Task 4: State (watermark) module

**Files:**
- Create: `collector/src/tokei_collector/state.py`
- Create: `collector/tests/test_state.py`

- [ ] **Step 1: Write failing test**

`collector/tests/test_state.py`:

```python
from pathlib import Path
import pytest

from tokei_collector.state import State, StateError, load_state


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
```

- [ ] **Step 2: Run test, expect failure**

```bash
uv run pytest tests/test_state.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement state module**

`collector/src/tokei_collector/state.py`:

```python
"""Watermark state persisted to ~/.tokei/state.json."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class StateError(Exception):
    pass


@dataclass
class State:
    path: Path
    watermarks: dict[str, dict[str, Any]] = field(default_factory=dict)

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
    return State(path=path, watermarks=data)
```

- [ ] **Step 4: Run test, expect pass**

```bash
uv run pytest tests/test_state.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add collector/src/tokei_collector/state.py collector/tests/test_state.py
git commit -m "feat(collector): state module with corrupt-recovery backup"
```

---

## Task 5: Uploader with retry

**Files:**
- Create: `collector/src/tokei_collector/uploader.py`
- Create: `collector/tests/test_uploader.py`

- [ ] **Step 1: Write failing test**

`collector/tests/test_uploader.py`:

```python
from pytest_httpx import HTTPXMock
import pytest

from tokei_collector.models import Event
from tokei_collector.uploader import (
    HttpError,
    Uploader,
    UploadResult,
    BATCH_SIZE,
)


def sample_event(i: int = 0) -> Event:
    return Event(
        tool="claude_code",
        event_uuid=f"uuid-{i}",
        ts=1744370000 + i,
        model="claude-sonnet-4-5",
        input_tokens=100,
        output_tokens=50,
    )


def test_uploader_posts_events(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        json={"accepted": 2, "deduped": 0},
    )
    u = Uploader("https://worker.example", "test-token", "dev-1")
    result = u.upload([sample_event(0), sample_event(1)])
    assert result == UploadResult(accepted=2, deduped=0)


def test_uploader_splits_into_batches(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        json={"accepted": BATCH_SIZE, "deduped": 0},
    )
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        json={"accepted": 1, "deduped": 0},
    )

    events = [sample_event(i) for i in range(BATCH_SIZE + 1)]
    u = Uploader("https://worker.example", "test-token", "dev-1")
    result = u.upload(events)
    assert result.accepted == BATCH_SIZE + 1


def test_uploader_retries_on_5xx(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        status_code=500,
    )
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        status_code=500,
    )
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        json={"accepted": 1, "deduped": 0},
    )

    u = Uploader("https://worker.example", "test-token", "dev-1", retry_sleep=lambda _: None)
    result = u.upload([sample_event(0)])
    assert result.accepted == 1


def test_uploader_does_not_retry_on_4xx(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        status_code=401,
        text="UNAUTHORIZED",
    )
    u = Uploader("https://worker.example", "test-token", "dev-1", retry_sleep=lambda _: None)
    with pytest.raises(HttpError, match="401"):
        u.upload([sample_event(0)])


def test_uploader_sets_bearer_header(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://worker.example/v1/ingest",
        method="POST",
        match_headers={"Authorization": "Bearer my-token"},
        json={"accepted": 1, "deduped": 0},
    )
    u = Uploader("https://worker.example", "my-token", "dev-1")
    u.upload([sample_event(0)])
```

- [ ] **Step 2: Run test, expect failure**

```bash
uv run pytest tests/test_uploader.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement uploader**

`collector/src/tokei_collector/uploader.py`:

```python
"""Batch POST events to the worker /v1/ingest endpoint."""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import httpx

from .models import Event

BATCH_SIZE = 500
MAX_RETRIES = 4
RETRY_BACKOFF_BASE = 1.0


class HttpError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body}")
        self.status = status
        self.body = body


@dataclass(frozen=True, slots=True)
class UploadResult:
    accepted: int
    deduped: int


class Uploader:
    def __init__(
        self,
        worker_url: str,
        bearer_token: str,
        device_id: str,
        retry_sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.worker_url = worker_url.rstrip("/")
        self.bearer_token = bearer_token
        self.device_id = device_id
        self.retry_sleep = retry_sleep

    def upload(self, events: Sequence[Event]) -> UploadResult:
        total_accepted = 0
        total_deduped = 0
        for i in range(0, len(events), BATCH_SIZE):
            batch = list(events[i : i + BATCH_SIZE])
            result = self._upload_batch(batch)
            total_accepted += result.accepted
            total_deduped += result.deduped
        return UploadResult(accepted=total_accepted, deduped=total_deduped)

    def _upload_batch(self, batch: list[Event]) -> UploadResult:
        payload = {
            "device_id": self.device_id,
            "events": [e.to_dict() for e in batch],
        }
        headers = {"Authorization": f"Bearer {self.bearer_token}"}

        last_err: HttpError | None = None
        for attempt in range(MAX_RETRIES):
            try:
                with httpx.Client(timeout=30.0) as client:
                    response = client.post(
                        f"{self.worker_url}/v1/ingest",
                        json=payload,
                        headers=headers,
                    )
            except httpx.HTTPError as e:
                last_err = HttpError(0, str(e))
                self.retry_sleep(RETRY_BACKOFF_BASE * (2**attempt))
                continue

            if 200 <= response.status_code < 300:
                data = response.json()
                return UploadResult(accepted=int(data["accepted"]), deduped=int(data["deduped"]))

            if 400 <= response.status_code < 500:
                raise HttpError(response.status_code, response.text)

            last_err = HttpError(response.status_code, response.text)
            self.retry_sleep(RETRY_BACKOFF_BASE * (2**attempt))

        assert last_err is not None
        raise last_err
```

- [ ] **Step 4: Run test, expect pass**

```bash
uv run pytest tests/test_uploader.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add collector/src/tokei_collector/uploader.py collector/tests/test_uploader.py
git commit -m "feat(collector): uploader with batch + exponential retry"
```

---

## Task 6: Parser protocol

**Files:**
- Create: `collector/src/tokei_collector/parsers/__init__.py`
- Create: `collector/src/tokei_collector/parsers/base.py`

- [ ] **Step 1: Write parsers/__init__.py**

`collector/src/tokei_collector/parsers/__init__.py`:

```python
"""Parser implementations for supported AI tools."""
```

- [ ] **Step 2: Write parsers/base.py**

`collector/src/tokei_collector/parsers/base.py`:

```python
"""Parser protocol and context shared across all tool parsers."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from ..models import Event


@dataclass(frozen=True, slots=True)
class ParserContext:
    home: Path
    gemini_outfile: Path | None = None


class Parser(Protocol):
    tool_name: str

    def scan(
        self, ctx: ParserContext, watermark: dict[str, Any]
    ) -> Iterator[Event]:
        """Yield new Events since the watermark and update it in-place.

        The runner saves the watermark to disk only after all events from
        this parser have been uploaded successfully. If the upload fails,
        the watermark is discarded and the next run re-scans from the
        previous position, relying on worker-side dedup by event_uuid.
        """
        ...
```

- [ ] **Step 3: Type check**

```bash
uv run pyright src
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add collector/src/tokei_collector/parsers/
git commit -m "feat(collector): parser protocol and context"
```

---

## Task 7: Claude Code parser

**Files:**
- Create: `collector/src/tokei_collector/parsers/claude_code.py`
- Create: `collector/tests/test_parsers_claude_code.py`
- Create: `collector/tests/fixtures/claude_code/session_sample.jsonl`

- [ ] **Step 1: Write fixture**

`collector/tests/fixtures/claude_code/session_sample.jsonl`:

```jsonl
{"type": "user", "uuid": "11111111-1111-1111-1111-111111111111", "message": {"role": "user", "content": "hello"}, "timestamp": "2026-04-12T10:00:00Z"}
{"type": "assistant", "uuid": "22222222-2222-2222-2222-222222222222", "message": {"role": "assistant", "model": "claude-sonnet-4-5", "content": "hi", "usage": {"input_tokens": 1200, "output_tokens": 20, "cache_read_input_tokens": 800, "cache_creation_input_tokens": 0}}, "timestamp": "2026-04-12T10:00:01Z"}
{"type": "assistant", "uuid": "33333333-3333-3333-3333-333333333333", "message": {"role": "assistant", "model": "claude-opus-4-6", "content": "reply", "usage": {"input_tokens": 2400, "output_tokens": 150, "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 500}}, "timestamp": "2026-04-12T10:00:30Z"}
```

- [ ] **Step 2: Write failing test**

`collector/tests/test_parsers_claude_code.py`:

```python
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
```

- [ ] **Step 3: Run test, expect failure**

```bash
uv run pytest tests/test_parsers_claude_code.py -v
```

Expected: FAIL.

- [ ] **Step 4: Implement the Claude Code parser**

`collector/src/tokei_collector/parsers/claude_code.py`:

```python
"""Parse Claude Code session JSONL files under ~/.claude/projects/<proj>/<session>.jsonl."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

from ..models import Event
from .base import ParserContext


class ClaudeCodeParser:
    tool_name = "claude_code"

    def scan(
        self, ctx: ParserContext, watermark: dict[str, Any]
    ) -> Iterator[Event]:
        projects = ctx.home / ".claude" / "projects"
        if not projects.exists():
            return

        file_offsets: dict[str, int] = watermark.setdefault("file_offsets", {})  # type: ignore[assignment]

        for jsonl_path in sorted(projects.rglob("*.jsonl")):
            rel_key = str(jsonl_path.relative_to(projects))
            start_offset = int(file_offsets.get(rel_key, 0))

            try:
                fsize = jsonl_path.stat().st_size
            except OSError:
                continue
            if fsize < start_offset:
                # File was rotated/truncated, restart
                start_offset = 0

            with jsonl_path.open("rb") as f:
                f.seek(start_offset)
                while True:
                    line_start = f.tell()
                    raw = f.readline()
                    if not raw:
                        break
                    if not raw.endswith(b"\n"):
                        # Partial line at EOF; stop here and revisit next run
                        f.seek(line_start)
                        break
                    try:
                        obj = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    event = _extract_assistant_event(obj)
                    if event is not None:
                        yield event

                file_offsets[rel_key] = f.tell()


def _extract_assistant_event(obj: dict[str, Any]) -> Event | None:
    if obj.get("type") != "assistant":
        return None
    message = obj.get("message")
    if not isinstance(message, dict):
        return None
    usage = message.get("usage")
    if not isinstance(usage, dict):
        return None

    uuid = obj.get("uuid")
    if not isinstance(uuid, str) or not uuid:
        return None

    ts_raw = obj.get("timestamp")
    if isinstance(ts_raw, str):
        try:
            ts = int(datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).timestamp())
        except ValueError:
            ts = 0
    else:
        ts = 0

    model = message.get("model") if isinstance(message.get("model"), str) else None

    return Event(
        tool="claude_code",
        event_uuid=uuid,
        ts=ts,
        model=model,
        input_tokens=int(usage.get("input_tokens", 0) or 0),
        output_tokens=int(usage.get("output_tokens", 0) or 0),
        cached_input_tokens=int(usage.get("cache_read_input_tokens", 0) or 0),
        cache_creation_tokens=int(usage.get("cache_creation_input_tokens", 0) or 0),
        reasoning_output_tokens=0,
    )
```

- [ ] **Step 5: Run test, expect pass**

```bash
uv run pytest tests/test_parsers_claude_code.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add collector/src/tokei_collector/parsers/claude_code.py collector/tests/test_parsers_claude_code.py collector/tests/fixtures/claude_code/
git commit -m "feat(collector): claude_code parser with per-file offset watermark"
```

---

## Task 8: Codex parser

**Files:**
- Create: `collector/src/tokei_collector/parsers/codex.py`
- Create: `collector/tests/test_parsers_codex.py`
- Create: `collector/tests/fixtures/codex/rollout_sample.jsonl`

- [ ] **Step 1: Write fixture**

`collector/tests/fixtures/codex/rollout_sample.jsonl`:

```jsonl
{"timestamp":"2026-04-12T10:00:00.000Z","type":"session_meta","payload":{"id":"sess-1","model_provider":"openai","cli_version":"0.108.0"}}
{"timestamp":"2026-04-12T10:00:05.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":500,"output_tokens":100,"reasoning_output_tokens":50,"total_tokens":1150},"last_token_usage":{"input_tokens":1000,"cached_input_tokens":500,"output_tokens":100,"reasoning_output_tokens":50,"total_tokens":1150}}}}
{"timestamp":"2026-04-12T10:00:15.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2500,"cached_input_tokens":1200,"output_tokens":250,"reasoning_output_tokens":80,"total_tokens":2830},"last_token_usage":{"input_tokens":1500,"cached_input_tokens":700,"output_tokens":150,"reasoning_output_tokens":30,"total_tokens":1680}}}}
{"timestamp":"2026-04-12T10:00:20.000Z","type":"event_msg","payload":{"type":"other_event","info":{}}}
```

- [ ] **Step 2: Write failing test**

`collector/tests/test_parsers_codex.py`:

```python
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
```

- [ ] **Step 3: Run test, expect failure**

```bash
uv run pytest tests/test_parsers_codex.py -v
```

Expected: FAIL.

- [ ] **Step 4: Implement codex parser**

`collector/src/tokei_collector/parsers/codex.py`:

```python
"""Parse Codex CLI session rollout JSONL under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

from ..models import Event
from .base import ParserContext


class CodexParser:
    tool_name = "codex"

    def scan(
        self, ctx: ParserContext, watermark: dict[str, Any]
    ) -> Iterator[Event]:
        sessions = ctx.home / ".codex" / "sessions"
        if not sessions.exists():
            return

        processed: dict[str, int] = watermark.setdefault("processed_events", {})  # type: ignore[assignment]

        for rollout in sorted(sessions.rglob("rollout-*.jsonl")):
            rel_key = str(rollout.relative_to(sessions))
            last_index = int(processed.get(rel_key, -1))

            session_id: str | None = None
            current_index = -1

            try:
                with rollout.open("r", encoding="utf-8") as f:
                    for raw in f:
                        try:
                            obj = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        typ = obj.get("type")
                        payload = obj.get("payload")
                        if not isinstance(payload, dict):
                            continue

                        if typ == "session_meta" and session_id is None:
                            sid = payload.get("id")
                            if isinstance(sid, str):
                                session_id = sid

                        if typ != "event_msg":
                            continue
                        if payload.get("type") != "token_count":
                            continue
                        info = payload.get("info")
                        if not isinstance(info, dict):
                            continue
                        last_usage = info.get("last_token_usage")
                        if not isinstance(last_usage, dict):
                            continue

                        current_index += 1
                        if current_index <= last_index:
                            continue
                        if session_id is None:
                            continue

                        yield _event_from(obj, session_id, current_index, last_usage)

            except OSError:
                continue

            if current_index >= 0:
                processed[rel_key] = current_index


def _event_from(
    obj: dict[str, Any],
    session_id: str,
    index: int,
    last_usage: dict[str, Any],
) -> Event:
    ts_raw = obj.get("timestamp")
    ts = 0
    if isinstance(ts_raw, str):
        try:
            ts = int(datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).timestamp())
        except ValueError:
            ts = 0

    return Event(
        tool="codex",
        event_uuid=f"{session_id}:{index}",
        ts=ts,
        model=None,
        input_tokens=int(last_usage.get("input_tokens", 0) or 0),
        output_tokens=int(last_usage.get("output_tokens", 0) or 0),
        cached_input_tokens=int(last_usage.get("cached_input_tokens", 0) or 0),
        cache_creation_tokens=0,
        reasoning_output_tokens=int(last_usage.get("reasoning_output_tokens", 0) or 0),
    )
```

Note: Codex rollout files don't consistently include an exact model name in the session_meta (the current format has `model_provider` and `model_context_window` but not always a `model` field). We emit `model=None` which triggers the worker's Opus fallback. If future versions include a stable model field, adapt here.

- [ ] **Step 5: Run test, expect pass**

```bash
uv run pytest tests/test_parsers_codex.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add collector/src/tokei_collector/parsers/codex.py collector/tests/test_parsers_codex.py collector/tests/fixtures/codex/
git commit -m "feat(collector): codex parser emitting per-event deltas"
```

---

## Task 9: Cursor parser

**Files:**
- Create: `collector/src/tokei_collector/parsers/cursor.py`
- Create: `collector/tests/test_parsers_cursor.py`
- Create: `collector/tests/conftest.py` (for shared fixtures)

- [ ] **Step 1: Write conftest**

`collector/tests/conftest.py`:

```python
"""Shared pytest fixtures."""

import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def cursor_state_db(tmp_path: Path) -> Path:
    """Create a minimal state.vscdb SQLite file with the cursorDiskKV table."""
    db_path = tmp_path / "state.vscdb"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE cursorDiskKV (
                key TEXT PRIMARY KEY,
                value BLOB
            )
            """
        )
    return db_path
```

- [ ] **Step 2: Write failing test**

`collector/tests/test_parsers_cursor.py`:

```python
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
    db = home / "Library" / "Application Support" / "Cursor" / "User" / "globalStorage" / "state.vscdb"
    _insert_bubble(db, "bub-1", input_tokens=27909, output_tokens=9129, usage_uuid="usage-1", client_end_time_ms=1744370000000)
    _insert_bubble(db, "bub-2", input_tokens=1000, output_tokens=500, usage_uuid="usage-2", client_end_time_ms=1744370010000)

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
    db = home / "Library" / "Application Support" / "Cursor" / "User" / "globalStorage" / "state.vscdb"
    _insert_bubble(db, "user-1", input_tokens=0, output_tokens=0, usage_uuid="usage-zero", client_end_time_ms=1744370000000)
    _insert_bubble(db, "asst-1", input_tokens=500, output_tokens=200, usage_uuid="usage-real", client_end_time_ms=1744370000000)

    parser = CursorParser()
    ctx = ParserContext(home=home)
    events = list(parser.scan(ctx, {}))
    assert len(events) == 1
    assert events[0].event_uuid == "usage-real"


def test_watermark_skips_previously_seen_usage_uuids(tmp_path: Path):
    home = _setup_cursor_home(tmp_path)
    db = home / "Library" / "Application Support" / "Cursor" / "User" / "globalStorage" / "state.vscdb"
    _insert_bubble(db, "b1", input_tokens=100, output_tokens=50, usage_uuid="u1", client_end_time_ms=1744370000000)

    parser = CursorParser()
    ctx = ParserContext(home=home)
    wm: dict[str, object] = {}
    first = list(parser.scan(ctx, wm))
    assert len(first) == 1

    _insert_bubble(db, "b2", input_tokens=200, output_tokens=80, usage_uuid="u2", client_end_time_ms=1744370010000)

    second = list(parser.scan(ctx, wm))
    assert len(second) == 1
    assert second[0].event_uuid == "u2"


def test_missing_cursor_db_returns_empty(tmp_path: Path):
    ctx = ParserContext(home=tmp_path)
    parser = CursorParser()
    assert list(parser.scan(ctx, {})) == []
```

- [ ] **Step 3: Run test, expect failure**

```bash
uv run pytest tests/test_parsers_cursor.py -v
```

Expected: FAIL.

- [ ] **Step 4: Implement cursor parser**

`collector/src/tokei_collector/parsers/cursor.py`:

```python
"""Parse Cursor state.vscdb bubbleId:* blobs for token usage."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from ..models import Event
from .base import ParserContext

CURSOR_GLOBAL_STORAGE = (
    "Library/Application Support/Cursor/User/globalStorage/state.vscdb"
)


class CursorParser:
    tool_name = "cursor"

    def scan(
        self, ctx: ParserContext, watermark: dict[str, Any]
    ) -> Iterator[Event]:
        db_path = ctx.home / CURSOR_GLOBAL_STORAGE
        if not db_path.exists():
            return

        seen_uuids: set[str] = set(watermark.setdefault("seen_uuids", []))  # type: ignore[arg-type]

        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        except sqlite3.Error:
            return

        try:
            cursor = conn.execute(
                "SELECT value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'"
            )
            for (raw,) in cursor:
                if isinstance(raw, bytes):
                    text = raw.decode("utf-8", errors="replace")
                else:
                    text = str(raw)
                try:
                    obj = json.loads(text)
                except json.JSONDecodeError:
                    continue
                event = _extract_event(obj, seen_uuids)
                if event is not None:
                    seen_uuids.add(event.event_uuid)
                    yield event
        finally:
            conn.close()

        watermark["seen_uuids"] = sorted(seen_uuids)


def _extract_event(obj: dict[str, Any], seen: set[str]) -> Event | None:
    token_count = obj.get("tokenCount")
    if not isinstance(token_count, dict):
        return None
    input_tokens = int(token_count.get("inputTokens", 0) or 0)
    output_tokens = int(token_count.get("outputTokens", 0) or 0)
    if input_tokens == 0 and output_tokens == 0:
        return None

    usage_uuid = obj.get("usageUuid")
    if not isinstance(usage_uuid, str) or not usage_uuid:
        return None
    if usage_uuid in seen:
        return None

    timing = obj.get("timingInfo")
    ts = 0
    if isinstance(timing, dict):
        end_ms = timing.get("clientEndTime")
        if isinstance(end_ms, int | float):
            ts = int(end_ms / 1000)

    return Event(
        tool="cursor",
        event_uuid=usage_uuid,
        ts=ts,
        model=None,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cached_input_tokens=0,
        cache_creation_tokens=0,
        reasoning_output_tokens=0,
    )
```

- [ ] **Step 5: Run test, expect pass**

```bash
uv run pytest tests/test_parsers_cursor.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add collector/src/tokei_collector/parsers/cursor.py collector/tests/test_parsers_cursor.py collector/tests/conftest.py
git commit -m "feat(collector): cursor parser reading state.vscdb via sqlite3"
```

---

## Task 10: Gemini parser

**Files:**
- Create: `collector/src/tokei_collector/parsers/gemini.py`
- Create: `collector/tests/test_parsers_gemini.py`
- Create: `collector/tests/fixtures/gemini/telemetry_sample.log`

- [ ] **Step 1: Write fixture**

Gemini CLI's `FileLogExporter` writes OTLP log records as `safeJsonStringify(data, 2) + '\n'` which produces pretty-printed JSON followed by a newline. Each "record" is a multi-line JSON object. Our parser needs to split on object boundaries.

For the fixture, we use compact single-line JSON records (one per line) which the parser must accept. If Gemini's actual output is multi-line pretty-printed, we'll handle that in the implementation by streaming-parsing.

`collector/tests/fixtures/gemini/telemetry_sample.log`:

```jsonl
{"body":{"event.name":"gemini_cli.api_response","model":"gemini-2.5-pro","input_token_count":5000,"output_token_count":800,"cached_content_token_count":1000,"thoughts_token_count":120,"tool_token_count":0,"request_id":"req-1"},"timeUnixNano":"1744370000000000000"}
{"body":{"event.name":"gemini_cli.other_event"},"timeUnixNano":"1744370005000000000"}
{"body":{"event.name":"gemini_cli.api_response","model":"gemini-2.0-flash","input_token_count":2000,"output_token_count":300,"cached_content_token_count":0,"thoughts_token_count":0,"tool_token_count":50,"request_id":"req-2"},"timeUnixNano":"1744370010000000000"}
```

- [ ] **Step 2: Write failing test**

`collector/tests/test_parsers_gemini.py`:

```python
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
```

- [ ] **Step 3: Run test, expect failure**

```bash
uv run pytest tests/test_parsers_gemini.py -v
```

Expected: FAIL.

- [ ] **Step 4: Implement gemini parser**

`collector/src/tokei_collector/parsers/gemini.py`:

```python
"""Parse Gemini CLI OTLP telemetry log (line-delimited JSON records).

Gemini CLI writes OTLP log records via FileLogExporter. Each record is one JSON
document per line (or may span multiple lines as pretty-printed JSON in some
versions). This parser accepts line-delimited compact JSON; if future Gemini
versions emit pretty-printed multi-line records, extend the reader to handle
object boundaries.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from ..models import Event
from .base import ParserContext

API_EVENT_NAME = "gemini_cli.api_response"


class GeminiParser:
    tool_name = "gemini"

    def scan(
        self, ctx: ParserContext, watermark: dict[str, Any]
    ) -> Iterator[Event]:
        log_path = ctx.gemini_outfile
        if log_path is None or not log_path.exists():
            return

        start_offset = int(watermark.get("offset", 0))
        try:
            fsize = log_path.stat().st_size
        except OSError:
            return

        if fsize < start_offset:
            start_offset = 0

        with log_path.open("rb") as f:
            f.seek(start_offset)
            while True:
                line_start = f.tell()
                raw = f.readline()
                if not raw:
                    break
                if not raw.endswith(b"\n"):
                    f.seek(line_start)
                    break
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                event = _extract_event(obj)
                if event is not None:
                    yield event
            watermark["offset"] = f.tell()


def _extract_event(obj: dict[str, Any]) -> Event | None:
    body = obj.get("body")
    if not isinstance(body, dict):
        return None
    if body.get("event.name") != API_EVENT_NAME:
        return None

    request_id = body.get("request_id")
    if not isinstance(request_id, str) or not request_id:
        return None

    model = body.get("model") if isinstance(body.get("model"), str) else None

    time_nano_raw = obj.get("timeUnixNano")
    ts = 0
    if isinstance(time_nano_raw, str):
        try:
            ts = int(int(time_nano_raw) // 1_000_000_000)
        except ValueError:
            ts = 0
    elif isinstance(time_nano_raw, int | float):
        ts = int(time_nano_raw // 1_000_000_000)

    return Event(
        tool="gemini",
        event_uuid=request_id,
        ts=ts,
        model=model,
        input_tokens=int(body.get("input_token_count", 0) or 0),
        output_tokens=int(body.get("output_token_count", 0) or 0),
        cached_input_tokens=int(body.get("cached_content_token_count", 0) or 0),
        cache_creation_tokens=0,
        reasoning_output_tokens=int(body.get("thoughts_token_count", 0) or 0),
    )
```

- [ ] **Step 5: Run test, expect pass**

```bash
uv run pytest tests/test_parsers_gemini.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add collector/src/tokei_collector/parsers/gemini.py collector/tests/test_parsers_gemini.py collector/tests/fixtures/gemini/
git commit -m "feat(collector): gemini parser reading OTLP telemetry log"
```

---

## Task 11: Runner (end-to-end scan + upload loop)

**Files:**
- Create: `collector/src/tokei_collector/runner.py`
- Create: `collector/src/tokei_collector/errlog.py`
- Create: `collector/tests/test_runner.py`

- [ ] **Step 1: Write errlog module**

`collector/src/tokei_collector/errlog.py`:

```python
"""Simple error log appending to ~/.tokei/error.log with 1 MB rotation."""

from __future__ import annotations

import time
import traceback
from pathlib import Path

MAX_SIZE_BYTES = 1_048_576


def default_error_log_path() -> Path:
    return Path.home() / ".tokei" / "error.log"


def log_error(message: str, exc: BaseException | None = None, path: Path | None = None) -> None:
    target = path or default_error_log_path()
    target.parent.mkdir(parents=True, exist_ok=True)

    if target.exists() and target.stat().st_size > MAX_SIZE_BYTES:
        backup = target.with_suffix(f".log.bak.{int(time.time())}")
        target.rename(backup)

    with target.open("a", encoding="utf-8") as f:
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        f.write(f"[{ts}] {message}\n")
        if exc is not None:
            f.write("".join(traceback.format_exception(exc)))
            f.write("\n")
```

- [ ] **Step 2: Write failing test**

`collector/tests/test_runner.py`:

```python
from __future__ import annotations

import shutil
from pathlib import Path
from pytest_httpx import HTTPXMock

from tokei_collector.config import Config
from tokei_collector.runner import run_once

CC_FIXTURE = Path(__file__).parent / "fixtures" / "claude_code" / "session_sample.jsonl"


def make_cfg(tmp_path: Path, worker_url: str) -> tuple[Config, Path]:
    home = tmp_path / "home"
    home.mkdir()
    projects = home / ".claude" / "projects" / "p"
    projects.mkdir(parents=True)
    shutil.copy(CC_FIXTURE, projects / "session.jsonl")

    state_path = tmp_path / "state.json"
    cfg = Config(
        device_id="test-dev",
        worker_url=worker_url,
        bearer_token="secret",
        enabled_parsers=["claude_code"],
        gemini_outfile=None,
        config_path=tmp_path / "config.toml",
    )
    return cfg, state_path


def test_run_once_uploads_events_and_advances_state(
    tmp_path: Path,
    httpx_mock: HTTPXMock,
    monkeypatch,
):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    cfg, state_path = make_cfg(tmp_path, "https://w.example")
    httpx_mock.add_response(
        url="https://w.example/v1/ingest",
        method="POST",
        json={"accepted": 2, "deduped": 0},
    )

    summary = run_once(cfg, state_path=state_path, home=tmp_path / "home")
    assert summary.total_uploaded == 2
    assert summary.total_deduped == 0
    assert summary.errors == []
    # State file should now exist with advanced watermark
    assert state_path.exists()


def test_run_once_preserves_watermark_on_upload_failure(
    tmp_path: Path,
    httpx_mock: HTTPXMock,
    monkeypatch,
):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    cfg, state_path = make_cfg(tmp_path, "https://w.example")
    # 5xx over all retries
    for _ in range(4):
        httpx_mock.add_response(
            url="https://w.example/v1/ingest",
            method="POST",
            status_code=500,
        )

    summary = run_once(
        cfg, state_path=state_path, home=tmp_path / "home", retry_sleep=lambda _: None
    )
    assert summary.total_uploaded == 0
    assert len(summary.errors) == 1
    # On failure, state file should NOT be saved so the next run retries
    assert not state_path.exists()


def test_run_once_skipped_parsers_not_enabled(tmp_path: Path, httpx_mock: HTTPXMock, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    cfg, state_path = make_cfg(tmp_path, "https://w.example")
    httpx_mock.add_response(
        url="https://w.example/v1/ingest",
        method="POST",
        json={"accepted": 2, "deduped": 0},
    )
    # Only claude_code is enabled; codex should not be touched
    summary = run_once(cfg, state_path=state_path, home=tmp_path / "home")
    assert "claude_code" in summary.parser_results
    assert "codex" not in summary.parser_results
```

- [ ] **Step 3: Run test, expect failure**

```bash
uv run pytest tests/test_runner.py -v
```

Expected: FAIL.

- [ ] **Step 4: Implement runner**

`collector/src/tokei_collector/runner.py`:

```python
"""End-to-end run loop: scan enabled parsers, upload events, save watermark."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from .config import Config
from .errlog import log_error
from .models import Event
from .parsers.base import Parser, ParserContext
from .parsers.claude_code import ClaudeCodeParser
from .parsers.codex import CodexParser
from .parsers.cursor import CursorParser
from .parsers.gemini import GeminiParser
from .state import State, load_state
from .uploader import HttpError, Uploader

PARSER_REGISTRY: dict[str, Callable[[], Parser]] = {
    "claude_code": ClaudeCodeParser,
    "codex": CodexParser,
    "cursor": CursorParser,
    "gemini": GeminiParser,
}


@dataclass
class ParserResult:
    event_count: int
    error: str | None = None


@dataclass
class RunSummary:
    total_uploaded: int
    total_deduped: int
    parser_results: dict[str, ParserResult] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    last_success_ts: int = 0


def run_once(
    cfg: Config,
    *,
    state_path: Path,
    home: Path | None = None,
    retry_sleep: Callable[[float], None] = time.sleep,
) -> RunSummary:
    home = home or Path.home()
    ctx = ParserContext(home=home, gemini_outfile=cfg.gemini_outfile)

    state = load_state(state_path)
    summary = RunSummary(total_uploaded=0, total_deduped=0)

    collected: list[Event] = []
    updated_watermarks: dict[str, dict[str, object]] = {}

    for name in cfg.enabled_parsers:
        factory = PARSER_REGISTRY.get(name)
        if factory is None:
            continue
        parser = factory()
        wm = dict(state.get(name))
        try:
            events = list(parser.scan(ctx, wm))
        except Exception as e:  # noqa: BLE001
            log_error(f"parser {name} crashed", exc=e)
            summary.parser_results[name] = ParserResult(
                event_count=0, error=f"{type(e).__name__}: {e}"
            )
            summary.errors.append(f"{name}: {e}")
            continue
        summary.parser_results[name] = ParserResult(event_count=len(events))
        collected.extend(events)
        updated_watermarks[name] = wm

    if not collected:
        summary.last_success_ts = int(time.time())
        for name, wm in updated_watermarks.items():
            state.set(name, wm)
        state.save()
        return summary

    uploader = Uploader(cfg.worker_url, cfg.bearer_token, cfg.device_id, retry_sleep=retry_sleep)
    try:
        result = uploader.upload(collected)
    except HttpError as e:
        log_error(f"upload failed: {e}", exc=e)
        summary.errors.append(f"upload: {e}")
        return summary

    summary.total_uploaded = result.accepted
    summary.total_deduped = result.deduped
    summary.last_success_ts = int(time.time())

    for name, wm in updated_watermarks.items():
        state.set(name, wm)
    state.save()
    return summary
```

- [ ] **Step 5: Run test, expect pass**

```bash
uv run pytest tests/test_runner.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add collector/src/tokei_collector/runner.py collector/src/tokei_collector/errlog.py collector/tests/test_runner.py
git commit -m "feat(collector): runner with parser isolation and state rollback"
```

---

## Task 12: Contract test against shared fixtures

**Files:**
- Create: `collector/tests/test_contract.py`

- [ ] **Step 1: Write the contract test**

`collector/tests/test_contract.py`:

```python
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
```

- [ ] **Step 2: Run test, expect pass**

```bash
uv run pytest tests/test_contract.py -v
```

Expected: 5 tests PASS (one per fixture file).

- [ ] **Step 3: Commit**

```bash
git add collector/tests/test_contract.py
git commit -m "test(collector): shared event fixtures contract test"
```

---

## Task 13: Doctor subcommand

**Files:**
- Create: `collector/src/tokei_collector/doctor.py`

- [ ] **Step 1: Implement doctor**

`collector/src/tokei_collector/doctor.py`:

```python
"""'doctor' subcommand: print state + last errors for troubleshooting."""

from __future__ import annotations

import sys
from pathlib import Path

from .config import Config, ConfigError, load_config
from .errlog import default_error_log_path
from .state import default_state_path, load_state


def run_doctor(config_path: Path | None = None) -> int:
    print("Tokei Collector Doctor")
    print("=" * 40)
    try:
        cfg: Config | None = load_config(config_path)
    except ConfigError as e:
        cfg = None
        print(f"CONFIG: ERROR - {e}")
    else:
        print(f"CONFIG: OK ({cfg.config_path})")
        print(f"  device_id: {cfg.device_id}")
        print(f"  worker_url: {cfg.worker_url}")
        print(f"  enabled_parsers: {', '.join(cfg.enabled_parsers)}")
        if cfg.gemini_outfile:
            print(f"  gemini_outfile: {cfg.gemini_outfile}")

    state = load_state(default_state_path())
    print()
    print(f"STATE: {state.path}")
    if not state.watermarks:
        print("  (empty - no previous runs)")
    for name, wm in state.watermarks.items():
        print(f"  {name}: {wm}")

    error_log = default_error_log_path()
    print()
    print(f"ERRORS: {error_log}")
    if not error_log.exists():
        print("  (no error log)")
    else:
        lines = error_log.read_text().splitlines()
        tail = lines[-20:] if len(lines) > 20 else lines
        print(f"  Showing last {len(tail)} of {len(lines)} lines:")
        for line in tail:
            print(f"  {line}")

    return 0 if cfg is not None else 1
```

- [ ] **Step 2: Commit**

```bash
git add collector/src/tokei_collector/doctor.py
git commit -m "feat(collector): doctor subcommand for status introspection"
```

---

## Task 14: CLI (argparse with all subcommands)

**Files:**
- Create: `collector/src/tokei_collector/cli.py`
- Create: `collector/src/tokei_collector/__main__.py`

- [ ] **Step 1: Write cli.py**

`collector/src/tokei_collector/cli.py`:

```python
"""CLI entry point: argparse setup for all tokei-collect subcommands."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import ConfigError, load_config
from .doctor import run_doctor
from .installers import install_launchd, install_systemd
from .runner import run_once
from .state import default_state_path


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="tokei-collect",
        description="Scan local AI tool logs and upload token usage to the Tokei worker.",
    )
    p.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Path to config.toml (default: ~/.tokei/config.toml)",
    )
    sub = p.add_subparsers(dest="command")

    sub.add_parser("run", help="Scan and upload once (default if no command given)")

    init_cmd = sub.add_parser("init", help="Interactively create ~/.tokei/config.toml")
    init_cmd.add_argument("--force", action="store_true", help="Overwrite existing config")

    sub.add_parser("backfill", help="Scan and upload from scratch (clears state)")

    sub.add_parser("doctor", help="Print config/state/errors for troubleshooting")

    install_cmd = sub.add_parser("install", help="Install timer unit for this platform")
    install_cmd.add_argument(
        "--launchd", action="store_true", help="macOS: install launchd plist"
    )
    install_cmd.add_argument(
        "--systemd", action="store_true", help="Linux: install systemd timer"
    )

    return p


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    parser = build_parser()
    args = parser.parse_args(argv)
    command = args.command or "run"

    if command == "run":
        return _cmd_run(args.config)
    if command == "init":
        return _cmd_init(args.config, force=args.force)
    if command == "backfill":
        return _cmd_backfill(args.config)
    if command == "doctor":
        return run_doctor(args.config)
    if command == "install":
        if args.launchd:
            return install_launchd()
        if args.systemd:
            return install_systemd()
        parser.error("install requires --launchd or --systemd")
    parser.error(f"Unknown command: {command}")
    return 1


def _cmd_run(config_path: Path | None) -> int:
    try:
        cfg = load_config(config_path)
    except ConfigError as e:
        print(f"config error: {e}", file=sys.stderr)
        return 2

    summary = run_once(cfg, state_path=default_state_path())
    print(
        f"uploaded={summary.total_uploaded} "
        f"deduped={summary.total_deduped} "
        f"errors={len(summary.errors)}"
    )
    for name, r in summary.parser_results.items():
        suffix = f" (ERROR: {r.error})" if r.error else ""
        print(f"  {name}: {r.event_count} events{suffix}")
    return 0 if not summary.errors else 1


def _cmd_init(config_path: Path | None, *, force: bool) -> int:
    target = config_path or (Path.home() / ".tokei" / "config.toml")
    if target.exists() and not force:
        print(f"{target} already exists. Use --force to overwrite.", file=sys.stderr)
        return 2

    print("Tokei Collector: interactive init")
    device_id = input("device_id (e.g., my-mac): ").strip()
    worker_url = input("worker_url (https://...workers.dev): ").strip()
    bearer_ref = input(
        "bearer_token (paste value OR 'env:TOKEI_TOKEN' to use env var): "
    ).strip()

    default_parsers = "claude_code, codex, cursor, gemini"
    parsers_raw = input(f"enabled_parsers [{default_parsers}]: ").strip() or default_parsers
    parsers = [p.strip() for p in parsers_raw.split(",") if p.strip()]

    content_lines = [
        f'device_id = "{device_id}"',
        f'worker_url = "{worker_url}"',
        f'bearer_token = "{bearer_ref}"',
        "",
        "[parsers]",
        "enabled = [" + ", ".join(f'"{p}"' for p in parsers) + "]",
    ]

    if "gemini" in parsers:
        gemini_outfile = input("gemini telemetry outfile [~/.gemini/telemetry.log]: ").strip()
        if not gemini_outfile:
            gemini_outfile = "~/.gemini/telemetry.log"
        content_lines.extend(["", "[parsers.gemini]", f'outfile = "{gemini_outfile}"'])

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(content_lines) + "\n")
    print(f"Wrote {target}")
    return 0


def _cmd_backfill(config_path: Path | None) -> int:
    try:
        cfg = load_config(config_path)
    except ConfigError as e:
        print(f"config error: {e}", file=sys.stderr)
        return 2

    state_path = default_state_path()
    if state_path.exists():
        backup = state_path.with_suffix(".json.bak.backfill")
        state_path.rename(backup)
        print(f"moved existing state to {backup}")

    summary = run_once(cfg, state_path=state_path)
    print(
        f"uploaded={summary.total_uploaded} "
        f"deduped={summary.total_deduped} "
        f"errors={len(summary.errors)}"
    )
    return 0 if not summary.errors else 1
```

- [ ] **Step 2: Write __main__.py**

`collector/src/tokei_collector/__main__.py`:

```python
"""Package entry for `python -m tokei_collector`."""

from .cli import main


def main_entry() -> int:
    return main()


if __name__ == "__main__":
    raise SystemExit(main_entry())


# Alias for pyproject.toml console_scripts
main = main  # noqa: PLW0127
```

- [ ] **Step 3: Type check**

```bash
uv run pyright src
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add collector/src/tokei_collector/cli.py collector/src/tokei_collector/__main__.py
git commit -m "feat(collector): argparse cli with run/init/backfill/doctor/install"
```

---

## Task 15: Installers (launchd + systemd)

**Files:**
- Create: `collector/src/tokei_collector/installers.py`
- Create: `collector/deploy/com.tokei.collector.plist.template`
- Create: `collector/deploy/tokei-collector.service.template`
- Create: `collector/deploy/tokei-collector.timer.template`

- [ ] **Step 1: Write launchd plist template**

`collector/deploy/com.tokei.collector.plist.template`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.tokei.collector</string>
    <key>ProgramArguments</key>
    <array>
        <string>__TOKEI_BINARY__</string>
        <string>run</string>
    </array>
    <key>StartInterval</key>
    <integer>900</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>__LOG_PATH__/tokei-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>__LOG_PATH__/tokei-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:__USER_LOCAL_BIN__</string>
    </dict>
</dict>
</plist>
```

- [ ] **Step 2: Write systemd service template**

`collector/deploy/tokei-collector.service.template`:

```ini
[Unit]
Description=Tokei Collector (single shot)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=__TOKEI_BINARY__ run
StandardOutput=journal
StandardError=journal
```

- [ ] **Step 3: Write systemd timer template**

`collector/deploy/tokei-collector.timer.template`:

```ini
[Unit]
Description=Run Tokei Collector every 15 minutes
Requires=tokei-collector.service

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Unit=tokei-collector.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 4: Implement installers.py**

`collector/src/tokei_collector/installers.py`:

```python
"""Generate launchd plist / systemd unit files for the current user."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

TEMPLATE_DIR = Path(__file__).parent.parent.parent / "deploy"


def _find_binary() -> str:
    candidate = shutil.which("tokei-collect")
    if candidate:
        return candidate
    return f"{sys.executable} -m tokei_collector"


def install_launchd() -> int:
    if sys.platform != "darwin":
        print("install --launchd is only supported on macOS", file=sys.stderr)
        return 2

    template = TEMPLATE_DIR / "com.tokei.collector.plist.template"
    if not template.exists():
        print(f"template missing: {template}", file=sys.stderr)
        return 2

    log_dir = Path.home() / "Library" / "Logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    content = template.read_text()
    content = content.replace("__TOKEI_BINARY__", _find_binary())
    content = content.replace("__LOG_PATH__", str(log_dir))
    content = content.replace("__USER_LOCAL_BIN__", str(Path.home() / ".local" / "bin"))

    dest = Path.home() / "Library" / "LaunchAgents" / "com.tokei.collector.plist"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content)

    print(f"Installed launchd plist: {dest}")
    print("To activate:")
    print(f"  launchctl unload {dest} 2>/dev/null; launchctl load {dest}")
    return 0


def install_systemd() -> int:
    if sys.platform != "linux":
        print("install --systemd is only supported on Linux", file=sys.stderr)
        return 2

    service_template = TEMPLATE_DIR / "tokei-collector.service.template"
    timer_template = TEMPLATE_DIR / "tokei-collector.timer.template"
    if not service_template.exists() or not timer_template.exists():
        print("systemd templates missing", file=sys.stderr)
        return 2

    xdg_config = os.environ.get("XDG_CONFIG_HOME")
    unit_dir = (
        Path(xdg_config) / "systemd" / "user"
        if xdg_config
        else Path.home() / ".config" / "systemd" / "user"
    )
    unit_dir.mkdir(parents=True, exist_ok=True)

    service_content = service_template.read_text().replace("__TOKEI_BINARY__", _find_binary())
    timer_content = timer_template.read_text()

    service_dest = unit_dir / "tokei-collector.service"
    timer_dest = unit_dir / "tokei-collector.timer"
    service_dest.write_text(service_content)
    timer_dest.write_text(timer_content)

    print(f"Installed service: {service_dest}")
    print(f"Installed timer:   {timer_dest}")
    print("To activate:")
    print("  systemctl --user daemon-reload")
    print("  systemctl --user enable --now tokei-collector.timer")
    return 0
```

- [ ] **Step 5: Type check**

```bash
uv run pyright src
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add collector/src/tokei_collector/installers.py collector/deploy/
git commit -m "feat(collector): launchd and systemd installer templates"
```

---

## Task 16: Smoke run against the deployed worker

**Files:**
- Modify: `collector/README.md` (append smoke test section)

- [ ] **Step 1: Run the full test suite to confirm everything still green**

```bash
cd /Users/chichi/workspace/xx/tokei/collector
uv run pytest -v
uv run ruff check src tests
uv run pyright src
```

Expected: all tests pass, lint clean, type check clean.

- [ ] **Step 2: Add smoke test steps to README**

Append to `collector/README.md`:

```markdown

## Smoke test against deployed worker

```bash
# Ensure config exists
uv run tokei-collect init

# Check state
uv run tokei-collect doctor

# Run once (will scan ~/.claude/projects and upload)
uv run tokei-collect run

# Verify on worker side
curl -s -H "Authorization: Bearer $TOKEI_TOKEN" \
    https://tokei-worker.chifan.workers.dev/v1/summary \
    | python3 -m json.tool
```

If `today.total_tokens > 0`, the full pipeline works.
```

- [ ] **Step 3: Commit**

```bash
git add collector/README.md
git commit -m "docs(collector): smoke test instructions against deployed worker"
```

---

## Final checklist

```bash
cd /Users/chichi/workspace/xx/tokei/collector
uv run pytest -v              # all tests pass
uv run ruff check src tests   # clean
uv run ruff format --check src tests
uv run pyright src            # clean
```

All four should exit 0.

Write a brief `collector/EXECUTION-REPORT.md` with:
- Table of task status
- Test count per module
- Any deviations from plan
- Known follow-ups (full 80-quote seed doesn't affect collector; Gemini parser assumes line-delimited JSON which may need adjustment for real OTLP output)

---

## Follow-up work (not in this plan)

1. Firmware plan (next sibling plan)
2. Verify Gemini parser shape against real `~/.gemini/telemetry.log` after user enables telemetry
3. Cursor model field extraction from sibling `messageRequestContext:*` keys (currently null → Opus fallback)
4. Multi-line OTLP record support if Gemini CLI emits pretty-printed JSON
5. Rate-limit friendly: skip upload if collected event count == 0 (minor optimization, already covered by no-op early return)
