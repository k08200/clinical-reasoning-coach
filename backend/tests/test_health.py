from __future__ import annotations

from httpx import AsyncClient


async def test_health_reports_configured_provider(client: AsyncClient):
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "app": "Clinical Reasoning Coach",
        "provider": "mock",
        "model": "mock",
    }
