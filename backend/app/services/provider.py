"""
Abstract LLM provider interface.

Providers: claude | ollama | mock
Selected via LLM_PROVIDER env var.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class StreamChunk:
    type: str  # thinking_start | thinking_delta | text_start | text_delta | usage | done
    content: str = ""
    usage: dict[str, int] = field(default_factory=dict)


@dataclass
class LLMResponse:
    text: str
    thinking: str
    input_tokens: int
    output_tokens: int
    thinking_tokens: int


class LLMProvider(Protocol):
    async def stream(
        self,
        messages: list[dict[str, Any]],
        system: str,
        operation: str,
    ) -> AsyncGenerator[StreamChunk, None]: ...

    async def complete(
        self,
        messages: list[dict[str, Any]],
        system: str,
    ) -> LLMResponse: ...
