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
