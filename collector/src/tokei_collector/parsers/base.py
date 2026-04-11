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
