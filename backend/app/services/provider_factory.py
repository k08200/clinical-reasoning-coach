"""
Provider factory — selects the LLM backend from LLM_PROVIDER env var.
"""
from __future__ import annotations

from functools import lru_cache

from app.config import get_settings
from app.services.provider import LLMResponse, StreamChunk


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


__all__ = ["get_provider", "LLMResponse", "StreamChunk"]
