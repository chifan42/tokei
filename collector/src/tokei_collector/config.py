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

    parsers_raw = raw.get("parsers", {})
    if not isinstance(parsers_raw, dict):
        raise ConfigError("[parsers] must be a table")
    parsers = cast(dict[str, object], parsers_raw)
    enabled_raw = parsers.get("enabled", [])
    if not isinstance(enabled_raw, list) or not all(isinstance(x, str) for x in cast(list[object], enabled_raw)):
        raise ConfigError("parsers.enabled must be a list of strings")
    enabled: list[str] = [str(x) for x in cast(list[str], enabled_raw)]
    unknown = [p for p in enabled if p not in KNOWN_PARSERS]
    if unknown:
        raise ConfigError(f"Unknown parser(s): {unknown}. Known: {sorted(KNOWN_PARSERS)}")

    gemini_outfile: Path | None = None
    gemini_raw = parsers.get("gemini", {})
    if isinstance(gemini_raw, dict):
        gemini_section = cast(dict[str, object], gemini_raw)
        outfile_raw = gemini_section.get("outfile")
        if isinstance(outfile_raw, str):
            gemini_outfile = Path(outfile_raw).expanduser()

    return Config(
        device_id=device_id,
        worker_url=worker_url.rstrip("/"),
        bearer_token=bearer_token,
        enabled_parsers=enabled,
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
