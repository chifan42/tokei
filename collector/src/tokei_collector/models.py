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
