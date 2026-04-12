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
        cursor_dashboard_token=None,
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
