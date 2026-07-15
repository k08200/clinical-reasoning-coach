from __future__ import annotations

from httpx import AsyncClient

from app import main
from app.services.provider import ProviderReadiness


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
