"""
Ollama provider — free local LLM via Ollama (https://ollama.com).

Setup:
  brew install ollama
  ollama pull llama3.2
  ollama serve   # starts on http://localhost:11434

Uses OpenAI-compatible API endpoint.
"""
from __future__ import annotations

import json
import re
from collections.abc import AsyncGenerator
from typing import Any

import httpx

from app.config import get_settings
from app.services.provider import ProviderReadiness, StreamChunk, LLMResponse

settings = get_settings()

OLLAMA_BASE_URL = settings.ollama_base_url
OLLAMA_MODEL = settings.ollama_model

SYSTEM_INSTRUCTION = """You are a Socratic clinical reasoning coach.
RULES:
1. NEVER state the diagnosis
2. ALWAYS respond with questions only
3. Guide through systematic reasoning
4. Challenge cognitive biases
Keep responses concise (2-3 questions max)."""


class OllamaProvider:
    """Local Ollama LLM — completely free, no API key."""

    async def readiness(self) -> ProviderReadiness:
        """Confirm that Ollama is reachable and the configured model is installed."""
        url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags"
        try:
            async with httpx.AsyncClient(
                timeout=settings.provider_readiness_timeout_seconds
            ) as client:
                response = await client.get(url)
                response.raise_for_status()
        except httpx.HTTPError:
            return ProviderReadiness(
                ready=False,
                verification="unavailable",
                detail="Ollama could not be reached for a readiness check.",
            )

        models = response.json().get("models", [])
        available_models = {
            model_name
            for model in models
            if isinstance(model, dict)
            for model_name in (model.get("name"), model.get("model"))
            if isinstance(model_name, str)
        }
        expected_models = {OLLAMA_MODEL}
        if ":" not in OLLAMA_MODEL:
            expected_models.add(f"{OLLAMA_MODEL}:latest")

        if expected_models.isdisjoint(available_models):
            return ProviderReadiness(
                ready=False,
                verification="unavailable",
                detail="The configured Ollama model is not installed.",
            )

        return ProviderReadiness(
            ready=True,
            verification="verified",
            detail="Ollama is reachable and the configured model is installed.",
        )

    async def stream(
        self,
        messages: list[dict[str, Any]],
        system: str,
        operation: str = "ollama",
    ) -> AsyncGenerator[StreamChunk, None]:
        yield StreamChunk(type="thinking_start")

        url = f"{OLLAMA_BASE_URL}/api/chat"
        payload = {
            "model": OLLAMA_MODEL,
            "messages": [{"role": "system", "content": system}, *messages],
            "stream": True,
        }

        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream("POST", url, json=payload) as resp:
                if resp.status_code != 200:
                    error = await resp.aread()
                    yield StreamChunk(type="text_delta", content=f"[Ollama error: {error.decode()[:200]}]")
                    yield StreamChunk(type="done")
                    return

                input_tokens = 0
                output_tokens = 0

                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if data.get("done"):
                        input_tokens = data.get("prompt_eval_count", 0)
                        output_tokens = data.get("eval_count", 0)
                        break

                    msg = data.get("message", {})
                    content = msg.get("content", "")
                    if content:
                        yield StreamChunk(type="text_delta", content=content)

        yield StreamChunk(
            type="usage",
            usage={
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "thinking_tokens": 0,
            },
        )
        yield StreamChunk(type="done")

    async def complete(
        self,
        messages: list[dict[str, Any]],
        system: str,
    ) -> LLMResponse:
        url = f"{OLLAMA_BASE_URL}/api/chat"
        payload = {
            "model": OLLAMA_MODEL,
            "messages": [{"role": "system", "content": system}, *messages],
            "stream": False,
            "format": "json",
        }

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        text = data.get("message", {}).get("content", "{}")
        return LLMResponse(
            text=text,
            thinking="",
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
            thinking_tokens=0,
        )
