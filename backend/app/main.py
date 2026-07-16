from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import (
    get_settings,
    model_release_approval_status,
    validate_runtime_settings,
)
from app.database import AsyncSessionLocal, init_db
from app.services.model_release_reviews import (
    current_model_release_clinical_reviews,
    required_model_release_clinical_reviewers,
)
from app.routers import analytics, auth, cases, governance, safety, sessions
from app.services.provider_factory import get_provider_readiness
from app.services.rate_limit import rate_limiter

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    validate_runtime_settings(settings)
    await init_db()
    await rate_limiter.initialize(settings)
    try:
        yield
    finally:
        await rate_limiter.close()


app = FastAPI(
    title="Clinical Reasoning Coach API",
    version="1.0.0",
    description="Socratic AI coach for medical diagnostic reasoning training",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(cases.router)
app.include_router(sessions.router)
app.include_router(analytics.router)
app.include_router(safety.router)
app.include_router(governance.router)


async def _production_operational_readiness_detail() -> tuple[bool, str]:
    """Check dependencies that can become unsafe after a successful startup."""
    model_release_current, model_release_detail = model_release_approval_status(settings)
    if not model_release_current:
        return False, model_release_detail
    if not await rate_limiter.operationally_ready():
        return False, "Redis request protection is unavailable."
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
            reviews = await current_model_release_clinical_reviews(db, settings)
    except Exception:
        return False, "Database is unavailable for release readiness verification."

    required_reviews = required_model_release_clinical_reviewers(settings)
    if len(reviews) < required_reviews:
        return False, (
            "The configured model release requires "
            f"{required_reviews} distinct currently verified clinician approvals."
        )
    return True, "Production dependencies and model release approvals are current."


@app.get("/health")
async def health() -> dict:
    provider = settings.llm_provider.lower()
    model_by_provider = {
        "claude": settings.claude_model,
        "ollama": settings.ollama_model,
        "mock": "mock",
    }
    return {
        "status": "ok",
        "app": settings.app_name,
        "provider": provider,
        "model": model_by_provider.get(provider, "unknown"),
    }


@app.get("/ready")
async def ready() -> JSONResponse:
    """Report whether the configured deployment can currently serve learner coaching."""
    provider = settings.llm_provider.lower()
    model_by_provider = {
        "claude": settings.claude_model,
        "ollama": settings.ollama_model,
        "mock": "mock",
    }
    readiness = await get_provider_readiness()
    operational_ready = True
    operational_detail = "Not required outside production."
    if settings.app_environment.lower() == "production":
        operational_ready, operational_detail = await _production_operational_readiness_detail()
    ready = readiness.ready and operational_ready
    payload = {
        "status": "ready" if ready else "not_ready",
        "app": settings.app_name,
        "provider": provider,
        "model": model_by_provider.get(provider, "unknown"),
        "verification": readiness.verification,
        "detail": readiness.detail,
        "operational_ready": operational_ready,
        "operational_detail": operational_detail,
    }
    return JSONResponse(
        content=payload,
        status_code=200 if ready else 503,
    )
