from __future__ import annotations

from contextlib import asynccontextmanager

from httpx import AsyncClient

from app import main
from app.config import Settings
from app.services.provider import ProviderReadiness


@asynccontextmanager
async def _ready_database_session():
    class DatabaseSession:
        async def execute(self, _statement):
            return None

    yield DatabaseSession()


async def test_health_reports_configured_provider(client: AsyncClient):
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "app": "Clinical Reasoning Coach",
        "provider": "mock",
        "model": "mock",
    }


async def test_ready_reports_available_provider(client: AsyncClient):
    response = await client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "app": "Clinical Reasoning Coach",
        "provider": "mock",
        "model": "mock",
        "verification": "verified",
        "detail": "Rule-based development provider is available.",
        "operational_ready": True,
        "operational_detail": "Not required outside production.",
    }


async def test_ready_returns_503_for_unavailable_provider(
    client: AsyncClient,
    monkeypatch,
):
    async def unavailable_provider() -> ProviderReadiness:
        return ProviderReadiness(
            ready=False,
            verification="unavailable",
            detail="Configured provider is unavailable.",
        )

    monkeypatch.setattr(main, "get_provider_readiness", unavailable_provider)

    response = await client.get("/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"
    assert response.json()["verification"] == "unavailable"


async def test_ready_requires_live_production_operational_dependencies(
    client: AsyncClient,
    monkeypatch,
):
    production_settings = Settings(
        app_environment="production",
        secret_key="replace-with-a-long-random-secret",
        database_auto_create_tables=False,
        llm_provider="ollama",
        rate_limit_enabled=True,
        clinical_review_minimum_distinct_reviewers=2,
    )
    monkeypatch.setattr(main, "settings", production_settings)

    async def available_provider() -> ProviderReadiness:
        return ProviderReadiness(
            ready=True,
            verification="verified",
            detail="Configured provider is ready.",
        )

    async def unavailable_operations() -> tuple[bool, str]:
        return False, "Redis request protection is unavailable."

    monkeypatch.setattr(main, "get_provider_readiness", available_provider)
    monkeypatch.setattr(
        main,
        "_production_operational_readiness_detail",
        unavailable_operations,
    )

    response = await client.get("/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"
    assert response.json()["operational_ready"] is False
    assert response.json()["operational_detail"] == "Redis request protection is unavailable."


async def test_ready_reports_current_production_operational_dependencies(
    client: AsyncClient,
    monkeypatch,
):
    production_settings = Settings(
        app_environment="production",
        secret_key="replace-with-a-long-random-secret",
        database_auto_create_tables=False,
        llm_provider="ollama",
        rate_limit_enabled=True,
        clinical_review_minimum_distinct_reviewers=2,
    )
    monkeypatch.setattr(main, "settings", production_settings)

    async def available_provider() -> ProviderReadiness:
        return ProviderReadiness(
            ready=True,
            verification="verified",
            detail="Configured provider is ready.",
        )

    async def available_operations() -> tuple[bool, str]:
        return True, "Production dependencies and model release approvals are current."

    monkeypatch.setattr(main, "get_provider_readiness", available_provider)
    monkeypatch.setattr(
        main,
        "_production_operational_readiness_detail",
        available_operations,
    )

    response = await client.get("/ready")

    assert response.status_code == 200
    assert response.json()["operational_ready"] is True
    assert response.json()["operational_detail"] == (
        "Production dependencies and model release approvals are current."
    )


async def test_production_operational_readiness_rejects_invalid_release_artifact(
    monkeypatch,
):
    monkeypatch.setattr(
        main,
        "model_release_approval_status",
        lambda _settings: (False, "Model release evaluation artifact is older than 90 days."),
    )

    ready, detail = await main._production_operational_readiness_detail()

    assert ready is False
    assert detail == "Model release evaluation artifact is older than 90 days."


async def test_production_operational_readiness_rejects_redis_loss(monkeypatch):
    monkeypatch.setattr(main, "model_release_approval_status", lambda _settings: (True, "current"))

    async def unavailable_redis() -> bool:
        return False

    monkeypatch.setattr(main.rate_limiter, "operationally_ready", unavailable_redis)

    ready, detail = await main._production_operational_readiness_detail()

    assert ready is False
    assert detail == "Redis request protection is unavailable."


async def test_production_operational_readiness_requires_independent_clinician_approvals(
    monkeypatch,
):
    monkeypatch.setattr(main, "model_release_approval_status", lambda _settings: (True, "current"))
    monkeypatch.setattr(main, "AsyncSessionLocal", _ready_database_session)

    async def available_redis() -> bool:
        return True

    async def no_reviews(_db, _settings):
        return []

    monkeypatch.setattr(main.rate_limiter, "operationally_ready", available_redis)
    monkeypatch.setattr(main, "current_model_release_clinical_reviews", no_reviews)
    monkeypatch.setattr(main, "required_model_release_clinical_reviewers", lambda _settings: 2)

    ready, detail = await main._production_operational_readiness_detail()

    assert ready is False
    assert detail == "The configured model release requires 2 distinct currently verified clinician approvals."


async def test_production_operational_readiness_reports_current_dependencies(monkeypatch):
    monkeypatch.setattr(main, "model_release_approval_status", lambda _settings: (True, "current"))
    monkeypatch.setattr(main, "AsyncSessionLocal", _ready_database_session)

    async def available_redis() -> bool:
        return True

    async def two_reviews(_db, _settings):
        return [object(), object()]

    monkeypatch.setattr(main.rate_limiter, "operationally_ready", available_redis)
    monkeypatch.setattr(main, "current_model_release_clinical_reviews", two_reviews)
    monkeypatch.setattr(main, "required_model_release_clinical_reviewers", lambda _settings: 2)

    ready, detail = await main._production_operational_readiness_detail()

    assert ready is True
    assert detail == "Production dependencies and model release approvals are current."
