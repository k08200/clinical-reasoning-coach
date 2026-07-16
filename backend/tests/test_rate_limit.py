from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.config import Settings, get_settings
from app.services import rate_limit as rate_limit_module
from app.services.rate_limit import RateLimiter, rate_limiter


async def test_login_rate_limit_returns_retry_after(
    client: AsyncClient,
    monkeypatch,
):
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "auth_login_rate_limit_per_minute", 1)
    await rate_limiter.reset()

    try:
        first = await client.post(
            "/api/auth/token",
            data={"username": "missing@test.com", "password": "wrongpass123"},
        )
        second = await client.post(
            "/api/auth/token",
            data={"username": "missing@test.com", "password": "wrongpass123"},
        )
    finally:
        await rate_limiter.reset()

    assert first.status_code == 401
    assert second.status_code == 429
    assert second.headers["retry-after"]
    assert second.json()["detail"]["code"] == "rate_limit_exceeded"


def test_trusted_proxy_client_identifier_uses_valid_forwarded_address(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "trusted_proxy_ips", ["127.0.0.1"])

    request = type(
        "RequestStub",
        (),
        {
            "client": type("ClientStub", (), {"host": "127.0.0.1"})(),
            "headers": {"x-forwarded-for": "203.0.113.8, 127.0.0.1"},
        },
    )()

    assert rate_limit_module.request_client_identifier(request) == "203.0.113.8"


def test_untrusted_proxy_client_identifier_ignores_forwarded_address(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "trusted_proxy_ips", [])

    request = type(
        "RequestStub",
        (),
        {
            "client": type("ClientStub", (), {"host": "198.51.100.4"})(),
            "headers": {"x-forwarded-for": "203.0.113.8"},
        },
    )()

    assert rate_limit_module.request_client_identifier(request) == "198.51.100.4"


async def test_production_rate_limiter_requires_redis(monkeypatch):
    class UnavailableRedis:
        async def ping(self) -> None:
            raise OSError("Redis is unavailable")

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(
        rate_limit_module.redis_asyncio,
        "from_url",
        lambda *_args, **_kwargs: UnavailableRedis(),
    )
    limiter = RateLimiter()
    settings = Settings(
        app_environment="production",
        rate_limit_enabled=True,
    )

    with pytest.raises(RuntimeError, match="Redis is required"):
        await limiter.initialize(settings)


async def test_operational_readiness_requires_a_live_redis_client(monkeypatch):
    class AvailableRedis:
        async def ping(self) -> None:
            return None

    class UnavailableRedis:
        async def ping(self) -> None:
            raise OSError("Redis is unavailable")

    production_settings = Settings(
        app_environment="production",
        rate_limit_enabled=True,
    )
    monkeypatch.setattr(rate_limit_module, "get_settings", lambda: production_settings)
    limiter = RateLimiter()
    limiter._redis = AvailableRedis()

    assert await limiter.operationally_ready() is True

    limiter._redis = UnavailableRedis()
    assert await limiter.operationally_ready() is False

    limiter._redis = None
    assert await limiter.operationally_ready() is False
