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
    command: str = args.command or "run"

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
