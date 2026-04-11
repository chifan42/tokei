"""'doctor' subcommand: print state + last errors for troubleshooting."""

from __future__ import annotations

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
