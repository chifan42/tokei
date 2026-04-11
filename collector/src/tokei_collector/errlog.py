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
