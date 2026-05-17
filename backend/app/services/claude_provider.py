"""
Anthropic Claude provider.

Requires: LLM_PROVIDER=claude and ANTHROPIC_API_KEY in .env
Uses extended thinking with adaptive mode + streaming.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import anthropic

from app.config import get_settings
from app.services.provider import StreamChunk, LLMResponse

settings = get_settings()


class ClaudeProvider:
    def _client(self) -> anthropic.AsyncAnthropic:
        return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def stream(
        self,
        messages: list[dict[str, Any]],
        system: str,
        operation: str = "unknown",
    ) -> AsyncGenerator[StreamChunk, None]:
        client = self._client()

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
                        if getattr(delta, "type", None) == "thinking_delta":
                            yield StreamChunk(
                                type="thinking_delta",
                                content=getattr(delta, "thinking", ""),
                            )
                        elif getattr(delta, "type", None) == "text_delta":
                            yield StreamChunk(
                                type="text_delta",
                                content=getattr(delta, "text", ""),
                            )

                elif event_type == "message_delta":
                    usage = getattr(event, "usage", None)
                    if usage:
                        yield StreamChunk(
                            type="usage",
                            usage={"output_tokens": getattr(usage, "output_tokens", 0)},
                        )

            final = await stream.get_final_message()
            thinking_t = sum(
                len(getattr(b, "thinking", "").split()) * 2
                for b in final.content
                if getattr(b, "type", None) == "thinking"
            )
            yield StreamChunk(
                type="usage",
                usage={
                    "input_tokens": final.usage.input_tokens,
                    "output_tokens": final.usage.output_tokens,
                    "thinking_tokens": thinking_t,
                },
            )
            yield StreamChunk(type="done")

    async def complete(
        self,
        messages: list[dict[str, Any]],
        system: str,
    ) -> LLMResponse:
        client = self._client()

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
                thinking_tokens += len(thinking_text.split()) * 2
            elif block_type == "text":
                response_text += getattr(block, "text", "")

        return LLMResponse(
            text=response_text,
            thinking=thinking_text,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            thinking_tokens=thinking_tokens,
        )
