"""
Core Claude API integration.

Extended thinking (adaptive) + streaming for real-time Socratic coaching.
Token usage is tracked on every call.
"""
from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any

import anthropic

from app.config import get_settings

settings = get_settings()


@dataclass
class ThinkingBlock:
    content: str
    tokens: int = 0


@dataclass
class StreamChunk:
    type: str  # thinking_delta | text_delta | usage | done
    content: str = ""
    usage: dict[str, int] = field(default_factory=dict)


@dataclass
class ClaudeResponse:
    text: str
    thinking: str
    input_tokens: int
    output_tokens: int
    thinking_tokens: int


def _build_client() -> anthropic.AsyncAnthropic:
    if not settings.anthropic_api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it to your .env file."
        )
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


async def stream_with_thinking(
    messages: list[dict[str, Any]],
    system: str,
    *,
    operation: str = "unknown",
) -> AsyncGenerator[StreamChunk, None]:
    """
    Stream a Claude response with extended adaptive thinking.

    Yields StreamChunk objects:
    - type="thinking_delta": internal reasoning (shown as loading indicator)
    - type="text_delta": actual response text streamed in real-time
    - type="usage": final token usage stats
    - type="done": end of stream
    """
    client = _build_client()

    async with client.messages.stream(
        model=settings.claude_model,
        max_tokens=settings.max_tokens + settings.thinking_budget_tokens,
        thinking={"type": "adaptive"},
        system=system,
        messages=messages,
    ) as stream:
        async for event in stream:
            event_type = getattr(event, "type", None)

            if event_type == "content_block_start":
                block = getattr(event, "content_block", None)
                if block and getattr(block, "type", None) == "thinking":
                    yield StreamChunk(type="thinking_start")
                elif block and getattr(block, "type", None) == "text":
                    yield StreamChunk(type="text_start")

            elif event_type == "content_block_delta":
                delta = getattr(event, "delta", None)
                if delta:
                    delta_type = getattr(delta, "type", None)
                    if delta_type == "thinking_delta":
                        yield StreamChunk(
                            type="thinking_delta",
                            content=getattr(delta, "thinking", ""),
                        )
                    elif delta_type == "text_delta":
                        yield StreamChunk(
                            type="text_delta",
                            content=getattr(delta, "text", ""),
                        )

            elif event_type == "message_delta":
                usage = getattr(event, "usage", None)
                if usage:
                    yield StreamChunk(
                        type="usage",
                        usage={
                            "output_tokens": getattr(usage, "output_tokens", 0),
                        },
                    )

        # Final message with full usage
        final = await stream.get_final_message()
        input_t = getattr(final.usage, "input_tokens", 0)
        output_t = getattr(final.usage, "output_tokens", 0)
        # Tally thinking tokens from content blocks
        thinking_t = sum(
            getattr(b, "thinking", None) and len(getattr(b, "thinking", "").split()) * 1
            or 0
            for b in final.content
            if getattr(b, "type", None) == "thinking"
        )
        yield StreamChunk(
            type="usage",
            usage={
                "input_tokens": input_t,
                "output_tokens": output_t,
                "thinking_tokens": thinking_t,
            },
        )
        yield StreamChunk(type="done")


async def complete_with_thinking(
    messages: list[dict[str, Any]],
    system: str,
) -> ClaudeResponse:
    """
    Non-streaming call with extended thinking. Used for analysis operations.
    """
    client = _build_client()

    response = await client.messages.create(
        model=settings.claude_model,
        max_tokens=settings.max_tokens + settings.thinking_budget_tokens,
        thinking={"type": "adaptive"},
        system=system,
        messages=messages,
    )

    thinking_text = ""
    response_text = ""
    thinking_tokens = 0

    for block in response.content:
        block_type = getattr(block, "type", None)
        if block_type == "thinking":
            thinking_text += getattr(block, "thinking", "")
            # Approximate thinking tokens
            thinking_tokens += len(thinking_text.split()) * 2
        elif block_type == "text":
            response_text += getattr(block, "text", "")

    return ClaudeResponse(
        text=response_text,
        thinking=thinking_text,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        thinking_tokens=thinking_tokens,
    )
