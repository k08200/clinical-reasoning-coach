from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from ipaddress import ip_address

DEFAULT_SECRET_KEY = "change-me-in-production"
DEFAULT_EDUCATIONAL_USE_CONSENT_VERSION = "2026-07-15"
VALID_LLM_PROVIDERS = {"claude", "curated", "ollama", "mock"}
MODEL_RELEASE_APPROVAL_MAX_VALID_DAYS = 366
MODEL_RELEASE_EVALUATION_SUITE_VERSION = "2026-07-18.1"
MODEL_RELEASE_EVALUATION_MAX_AGE_DAYS = 90
MODEL_RELEASE_EVALUATION_SCENARIO_IDS = (
    "diagnosis-and-dose-pressure",
    "korean-diagnosis-and-dose-pressure",
    "anticoagulation-safety-pressure",
    "prompt-injection-confidentiality-pressure",
    "korean-prompt-injection-pressure",
    "real-patient-emergency-redirect",
    "korean-real-patient-emergency-redirect",
    "overdose-emergency-redirect",
    "pediatric-respiratory-emergency-redirect",
    "pregnancy-bleeding-emergency-redirect",
    "self-harm-emergency-redirect",
)
MODEL_RELEASE_DELIVERY_POLICY_FILES = {
    "claude": ("socratic_coach.py", "provider_factory.py", "claude_provider.py"),
    "curated": (
        "socratic_coach.py",
        "provider_factory.py",
        "curated_provider.py",
        "mock_provider.py",
    ),
    "ollama": ("socratic_coach.py", "provider_factory.py", "ollama_provider.py"),
    "mock": ("socratic_coach.py", "provider_factory.py", "mock_provider.py"),
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        populate_by_name=True,
        protected_namespaces=(),
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
    # Options: "claude" | "curated" | "ollama" | "mock"
    # - mock  : no API key, rule-based Socratic questions (default)
    # - curated: deterministic source-bound Socratic questions for reviewed cases
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
    ollama_api_key: str = Field(default="", validation_alias="OLLAMA_API_KEY")
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
    # Production model-release approval. These values bind an external clinical
    # model evaluation to the exact provider/model deployed by this process.
    model_release_approval_id: str = Field(
        default="",
        validation_alias="MODEL_RELEASE_APPROVAL_ID",
    )
    model_release_approval_provider: str = Field(
        default="",
        validation_alias="MODEL_RELEASE_APPROVAL_PROVIDER",
    )
    model_release_approval_model: str = Field(
        default="",
        validation_alias="MODEL_RELEASE_APPROVAL_MODEL",
    )
    model_release_approval_expires_on: date | None = Field(
        default=None,
        validation_alias="MODEL_RELEASE_APPROVAL_EXPIRES_ON",
    )
    model_release_evaluation_sha256: str = Field(
        default="",
        validation_alias="MODEL_RELEASE_EVALUATION_SHA256",
    )
    model_release_evaluation_artifact_path: str = Field(
        default="",
        validation_alias="MODEL_RELEASE_EVALUATION_ARTIFACT_PATH",
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


def configured_provider_model(settings: Settings) -> str:
    provider = settings.llm_provider.lower()
    if provider == "claude":
        return settings.claude_model
    if provider == "ollama":
        return settings.ollama_model
    if provider == "curated":
        from app.services.curated_provider import CURATED_PROVIDER_MODEL

        return CURATED_PROVIDER_MODEL
    return "mock"


def model_release_delivery_policy_sha256(provider: str) -> str:
    """Fingerprint the exact coaching and provider-delivery code that was evaluated."""
    files = MODEL_RELEASE_DELIVERY_POLICY_FILES.get(provider.lower())
    if files is None:
        raise ValueError(f"Unknown provider for model release policy: {provider}")

    services_directory = Path(__file__).with_name("services")
    digest = hashlib.sha256()
    for filename in files:
        path = services_directory / filename
        digest.update(filename.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def model_release_approval_status(settings: Settings) -> tuple[bool, str]:
    provider = settings.llm_provider.lower()
    expected_model = configured_provider_model(settings)
    approval_id = settings.model_release_approval_id.strip()
    approval_provider = settings.model_release_approval_provider.strip().lower()
    approval_model = settings.model_release_approval_model.strip()
    expires_on = settings.model_release_approval_expires_on
    evaluation_sha256 = settings.model_release_evaluation_sha256.strip().lower()
    artifact_path = settings.model_release_evaluation_artifact_path.strip()

    if not all((
        approval_id,
        approval_provider,
        approval_model,
        expires_on,
        evaluation_sha256,
        artifact_path,
    )):
        return False, "Model release approval metadata is incomplete."
    if not re.fullmatch(r"[0-9a-f]{64}", evaluation_sha256):
        return False, "Model release evaluation hash must be a SHA-256 digest."
    if approval_provider != provider:
        return False, "Model release approval provider does not match the configured provider."
    if approval_model != expected_model:
        return False, "Model release approval model does not match the configured model."
    if expires_on < date.today():
        return False, "Model release approval has expired."
    if expires_on > date.today() + timedelta(days=MODEL_RELEASE_APPROVAL_MAX_VALID_DAYS):
        return False, "Model release approval expiry exceeds the maximum validity period."
    try:
        artifact = json.loads(Path(artifact_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False, "Model release evaluation artifact could not be read."
    if not isinstance(artifact, dict):
        return False, "Model release evaluation artifact must be a JSON object."
    artifact_digest = artifact.get("sha256")
    canonical_artifact = dict(artifact)
    canonical_artifact.pop("sha256", None)
    computed_digest = hashlib.sha256(
        json.dumps(canonical_artifact, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    if artifact_digest != evaluation_sha256 or computed_digest != evaluation_sha256:
        return False, "Model release evaluation artifact hash does not match the configured digest."
    if artifact.get("suite_version") != MODEL_RELEASE_EVALUATION_SUITE_VERSION:
        return False, "Model release evaluation artifact uses an unsupported suite version."
    if artifact.get("provider") != provider or artifact.get("model") != expected_model:
        return False, "Model release evaluation artifact does not match the configured provider and model."
    if artifact.get("delivery_policy_sha256") != model_release_delivery_policy_sha256(provider):
        return False, (
            "Model release evaluation artifact does not match the configured coaching "
            "delivery policy."
        )
    evaluated_at = artifact.get("evaluated_at")
    if not isinstance(evaluated_at, str):
        return False, "Model release evaluation artifact has an invalid evaluation timestamp."
    try:
        evaluated_at_datetime = datetime.fromisoformat(evaluated_at.replace("Z", "+00:00"))
    except ValueError:
        return False, "Model release evaluation artifact has an invalid evaluation timestamp."
    if evaluated_at_datetime.tzinfo is None:
        return False, "Model release evaluation artifact has an invalid evaluation timestamp."
    now = datetime.now(timezone.utc)
    if evaluated_at_datetime > now + timedelta(minutes=5):
        return False, "Model release evaluation artifact is dated in the future."
    if evaluated_at_datetime < now - timedelta(days=MODEL_RELEASE_EVALUATION_MAX_AGE_DAYS):
        return False, (
            "Model release evaluation artifact is older than "
            f"{MODEL_RELEASE_EVALUATION_MAX_AGE_DAYS} days."
        )
    scenarios = artifact.get("scenarios")
    if not isinstance(scenarios, list) or not scenarios:
        return False, "Model release evaluation artifact has no scenario results."
    scenario_ids = [
        scenario.get("id") if isinstance(scenario, dict) else None
        for scenario in scenarios
    ]
    if (
        len(scenario_ids) != len(MODEL_RELEASE_EVALUATION_SCENARIO_IDS)
        or set(scenario_ids) != set(MODEL_RELEASE_EVALUATION_SCENARIO_IDS)
    ):
        return False, (
            "Model release evaluation artifact does not contain the exact required "
            "safety scenarios."
        )
    if artifact.get("passed") is not True or any(
        not isinstance(scenario, dict) or scenario.get("passed") is not True
        for scenario in scenarios
    ):
        return False, "Model release evaluation artifact contains failed scenarios."
    return True, "Model release evaluation artifact matches the configured provider and model."


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
            "configure curated, ollama, or claude"
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

    if environment == "production":
        model_release_approved, model_release_detail = model_release_approval_status(settings)
        if not model_release_approved:
            raise RuntimeError(
                "APP_ENV=production requires a current model release approval: "
                + model_release_detail
            )
