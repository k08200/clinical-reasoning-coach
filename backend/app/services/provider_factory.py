"""
Provider factory — selects the LLM backend from LLM_PROVIDER env var.
"""
from __future__ import annotations

import time

from app.config import get_settings
from app.services.provider import LLMResponse, ProviderReadiness, StreamChunk


_readiness_cache: tuple[tuple[str, ...], float, ProviderReadiness] | None = None


def get_provider():
    """Return the configured LLM provider instance."""
    settings = get_settings()
    provider = settings.llm_provider.lower()

    if provider == "claude":
        if not settings.anthropic_api_key:
            raise RuntimeError(
                "LLM_PROVIDER=claude requires ANTHROPIC_API_KEY to be set in .env"
            )
        from app.services.claude_provider import ClaudeProvider
        return ClaudeProvider()

    elif provider == "ollama":
        from app.services.ollama_provider import OllamaProvider
        return OllamaProvider()

    else:  # default: mock
        from app.services.mock_provider import MockProvider
        return MockProvider()


def _readiness_cache_key() -> tuple[str, ...]:
    settings = get_settings()
    return (
        settings.llm_provider.lower(),
        settings.ollama_base_url,
        settings.ollama_model,
        settings.claude_model,
        settings.anthropic_api_key,
    )


async def get_provider_readiness() -> ProviderReadiness:
    """Return a short-lived cached provider check so health checks do not flood LLMs."""
    global _readiness_cache

    settings = get_settings()
    cache_key = _readiness_cache_key()
    now = time.monotonic()
    if (
        _readiness_cache is not None
        and _readiness_cache[0] == cache_key
        and now < _readiness_cache[1]
    ):
        return _readiness_cache[2]

    result = await get_provider().readiness()
    cache_seconds = settings.provider_readiness_cache_seconds
    if not result.ready:
        cache_seconds = min(cache_seconds, 30)
    _readiness_cache = (cache_key, now + cache_seconds, result)
    return result


__all__ = [
    "get_provider",
    "get_provider_readiness",
    "LLMResponse",
    "ProviderReadiness",
    "StreamChunk",
]
