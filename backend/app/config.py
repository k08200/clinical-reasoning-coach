from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # App
    app_name: str = "Clinical Reasoning Coach"
    debug: bool = False
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/clinical_coach"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # ─── LLM Provider ────────────────────────────────────────────────────────
    # Options: "claude" | "ollama" | "mock"
    # - mock  : no API key, rule-based Socratic questions (default)
    # - ollama: local LLM via Ollama (brew install ollama && ollama pull llama3.2)
    # - claude: Anthropic claude-opus-4-7 with extended thinking (requires API key)
    llm_provider: str = "mock"

    # Anthropic (only needed when llm_provider=claude)
    anthropic_api_key: str = ""
    claude_model: str = "claude-opus-4-7"
    thinking_budget_tokens: int = 8000
    max_tokens: int = 4096

    # Ollama (only needed when llm_provider=ollama)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"

    # CORS
    cors_origins: list[str] = ["http://localhost:3000", "http://frontend:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
