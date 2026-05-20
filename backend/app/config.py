from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

DEFAULT_SECRET_KEY = "change-me-in-production"
VALID_LLM_PROVIDERS = {"claude", "ollama", "mock"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        populate_by_name=True,
    )

    # App
    app_name: str = "Clinical Reasoning Coach"
    app_environment: str = Field(default="development", validation_alias="APP_ENV")
    debug: bool = False
    secret_key: str = DEFAULT_SECRET_KEY
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


def validate_runtime_settings(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    provider = settings.llm_provider.lower()
    environment = settings.app_environment.lower()

    if provider not in VALID_LLM_PROVIDERS:
        raise RuntimeError(
            "LLM_PROVIDER must be one of: "
            + ", ".join(sorted(VALID_LLM_PROVIDERS))
        )

    if provider == "claude" and not settings.anthropic_api_key:
        raise RuntimeError("LLM_PROVIDER=claude requires ANTHROPIC_API_KEY")

    if environment == "production" and settings.secret_key == DEFAULT_SECRET_KEY:
        raise RuntimeError("APP_ENV=production requires a non-default SECRET_KEY")
