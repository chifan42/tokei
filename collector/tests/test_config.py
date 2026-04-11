from pathlib import Path

import pytest

from tokei_collector.config import ConfigError, load_config


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
