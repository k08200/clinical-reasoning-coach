from __future__ import annotations

import asyncio
import hashlib
from ipaddress import ip_address
import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import HTTPException, Request, status
from redis import asyncio as redis_asyncio

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after_seconds: int = 0


class RateLimitStoreUnavailable(RuntimeError):
    pass


class RateLimiter:
    def __init__(self) -> None:
        self._redis: redis_asyncio.Redis | None = None
        self._memory_hits: dict[str, deque[float]] = defaultdict(deque)
        self._memory_lock = asyncio.Lock()

    async def initialize(self, settings: Settings) -> None:
        await self.close()
        if not settings.rate_limit_enabled:
            return

        client = redis_asyncio.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
        )
        try:
            await client.ping()
        except Exception as exc:
            await client.aclose()
            if settings.app_environment.lower() == "production":
                raise RuntimeError(
                    "Redis is required for production request rate limiting"
                ) from exc
            logger.warning(
                "Redis rate limiting is unavailable; using process-local development limits"
            )
            return

        self._redis = client

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None
        await self.reset()

    async def operationally_ready(self) -> bool:
        """Confirm the live Redis limiter is still usable after application startup."""
        settings = get_settings()
        if not settings.rate_limit_enabled:
            return settings.app_environment.lower() != "production"
        if self._redis is None:
            return False
        try:
            await self._redis.ping()
        except Exception:
            return False
        return True

    async def reset(self) -> None:
        async with self._memory_lock:
            self._memory_hits.clear()

    async def check(
        self,
        *,
        bucket: str,
        subject: str,
        maximum: int,
        window_seconds: int,
    ) -> RateLimitDecision:
        settings = get_settings()
        if not settings.rate_limit_enabled:
            return RateLimitDecision(allowed=True)

        key = self._key(bucket=bucket, subject=subject)
        if self._redis is not None:
            return await self._check_redis(
                key=key,
                maximum=maximum,
                window_seconds=window_seconds,
            )
        return await self._check_memory(
            key=key,
            maximum=maximum,
            window_seconds=window_seconds,
        )

    @staticmethod
    def _key(*, bucket: str, subject: str) -> str:
        digest = hashlib.sha256(subject.encode("utf-8")).hexdigest()
        return f"clinical-reasoning-coach:rate-limit:{bucket}:{digest}"

    async def _check_redis(
        self,
        *,
        key: str,
        maximum: int,
        window_seconds: int,
    ) -> RateLimitDecision:
        try:
            count = await self._redis.incr(key)
            if count == 1:
                await self._redis.expire(key, window_seconds)
            ttl = await self._redis.ttl(key)
        except Exception as exc:
            raise RateLimitStoreUnavailable("Redis rate limit operation failed") from exc

        if count <= maximum:
            return RateLimitDecision(allowed=True)
        return RateLimitDecision(allowed=False, retry_after_seconds=max(ttl, 1))

    async def _check_memory(
        self,
        *,
        key: str,
        maximum: int,
        window_seconds: int,
    ) -> RateLimitDecision:
        now = time.monotonic()
        cutoff = now - window_seconds
        async with self._memory_lock:
            hits = self._memory_hits[key]
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= maximum:
                retry_after = int(max(1, hits[0] + window_seconds - now))
                return RateLimitDecision(False, retry_after)
            hits.append(now)
        return RateLimitDecision(allowed=True)


rate_limiter = RateLimiter()


def request_client_identifier(request: Request) -> str:
    client = request.client
    direct_client = client.host if client else "unknown-client"
    settings = get_settings()
    if direct_client not in settings.trusted_proxy_ips:
        return direct_client

    forwarded_for = request.headers.get("x-forwarded-for", "")
    candidate = forwarded_for.split(",", 1)[0].strip()
    if not candidate:
        return direct_client
    try:
        return str(ip_address(candidate))
    except ValueError:
        return direct_client


async def enforce_rate_limit(
    *,
    bucket: str,
    subject: str,
    maximum: int,
    window_seconds: int,
) -> None:
    try:
        decision = await rate_limiter.check(
            bucket=bucket,
            subject=subject,
            maximum=maximum,
            window_seconds=window_seconds,
        )
    except RateLimitStoreUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "rate_limit_store_unavailable",
                "message": "Request protection is temporarily unavailable. Try again shortly.",
            },
        ) from exc

    if decision.allowed:
        return
    retry_after = decision.retry_after_seconds
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "code": "rate_limit_exceeded",
            "message": "Too many requests. Try again after the retry interval.",
            "retry_after_seconds": retry_after,
        },
        headers={"Retry-After": str(retry_after)},
    )
