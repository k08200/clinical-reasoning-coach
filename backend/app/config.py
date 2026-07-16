from __future__ import annotations

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from ipaddress import ip_address

DEFAULT_SECRET_KEY = "change-me-in-production"
DEFAULT_EDUCATIONAL_USE_CONSENT_VERSION = "2026-07-15"
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
    admin_bootstrap_token: str = Field(
        default="",
        validation_alias="ADMIN_BOOTSTRAP_TOKEN",
    )
    educational_use_consent_version: str = Field(
        default=DEFAULT_EDUCATIONAL_USE_CONSENT_VERSION,
        validation_alias="EDUCATIONAL_USE_CONSENT_VERSION",
    )
    reviewer_credential_valid_days: int = Field(
        default=365,
        ge=1,
        le=7300,
        validation_alias="REVIEWER_CREDENTIAL_VALID_DAYS",
    )
    clinical_review_minimum_distinct_reviewers: int = Field(
        default=1,
        ge=1,
        le=5,
        validation_alias="CLINICAL_REVIEW_MINIMUM_DISTINCT_REVIEWERS",
    )

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@db:5432/clinical_coach"
    database_auto_create_tables: bool = Field(
        default=True,
        validation_alias="DATABASE_AUTO_CREATE_TABLES",
    )

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # Request limits. Production requires the Redis-backed limiter to be enabled.
    rate_limit_enabled: bool = Field(
        default=False,
        validation_alias="RATE_LIMIT_ENABLED",
    )
    trusted_proxy_ips: list[str] = Field(
        default_factory=list,
        validation_alias="TRUSTED_PROXY_IPS",
    )
    auth_registration_rate_limit_per_hour: int = Field(
        default=12,
        ge=1,
        le=1000,
        validation_alias="AUTH_REGISTRATION_RATE_LIMIT_PER_HOUR",
    )
    auth_login_rate_limit_per_minute: int = Field(
        default=12,
        ge=1,
        le=1000,
        validation_alias="AUTH_LOGIN_RATE_LIMIT_PER_MINUTE",
    )
    auth_refresh_rate_limit_per_minute: int = Field(
        default=60,
        ge=1,
        le=5000,
        validation_alias="AUTH_REFRESH_RATE_LIMIT_PER_MINUTE",
    )
    case_generation_rate_limit_per_hour: int = Field(
        default=12,
        ge=1,
        le=1000,
        validation_alias="CASE_GENERATION_RATE_LIMIT_PER_HOUR",
    )
    demo_case_rate_limit_per_hour: int = Field(
        default=60,
        ge=1,
        le=5000,
        validation_alias="DEMO_CASE_RATE_LIMIT_PER_HOUR",
    )
    coaching_stream_rate_limit_per_hour: int = Field(
        default=120,
        ge=1,
        le=10000,
        validation_alias="COACHING_STREAM_RATE_LIMIT_PER_HOUR",
    )

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
    ollama_min_context_tokens: int = Field(
        default=4096,
        ge=1024,
        le=262144,
        validation_alias="OLLAMA_MIN_CONTEXT_TOKENS",
    )
    provider_readiness_timeout_seconds: int = Field(
        default=10,
        ge=1,
        le=60,
        validation_alias="PROVIDER_READINESS_TIMEOUT_SECONDS",
    )
    provider_readiness_cache_seconds: int = Field(
        default=300,
        ge=1,
        le=3600,
        validation_alias="PROVIDER_READINESS_CACHE_SECONDS",
    )

    # CORS
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://frontend:3000",
    ]

    @field_validator("trusted_proxy_ips")
    @classmethod
    def validate_trusted_proxy_ips(cls, values: list[str]) -> list[str]:
        for value in values:
            try:
                ip_address(value)
            except ValueError as exc:
                raise ValueError("TRUSTED_PROXY_IPS must contain IP addresses") from exc
        return values


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

    if environment == "production" and settings.database_auto_create_tables:
        raise RuntimeError(
            "APP_ENV=production requires DATABASE_AUTO_CREATE_TABLES=false "
            "and Alembic migrations"
        )

    if environment == "production" and provider == "mock":
        raise RuntimeError(
            "APP_ENV=production does not allow LLM_PROVIDER=mock; "
            "configure ollama or claude"
        )

    if environment == "production" and not settings.rate_limit_enabled:
        raise RuntimeError(
            "APP_ENV=production requires RATE_LIMIT_ENABLED=true with Redis available"
        )

    if (
        environment == "production"
        and settings.clinical_review_minimum_distinct_reviewers < 2
    ):
        raise RuntimeError(
            "APP_ENV=production requires CLINICAL_REVIEW_MINIMUM_DISTINCT_REVIEWERS "
            "to be at least 2"
        )
