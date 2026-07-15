from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings, validate_runtime_settings
from app.database import init_db
from app.routers import analytics, auth, cases, governance, safety, sessions
from app.services.provider_factory import get_provider_readiness

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    validate_runtime_settings(settings)
    await init_db()
    yield


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
    """Report whether the configured LLM provider can currently serve requests."""
    provider = settings.llm_provider.lower()
    model_by_provider = {
        "claude": settings.claude_model,
        "ollama": settings.ollama_model,
        "mock": "mock",
    }
    readiness = await get_provider_readiness()
    payload = {
        "status": "ready" if readiness.ready else "not_ready",
        "app": settings.app_name,
        "provider": provider,
        "model": model_by_provider.get(provider, "unknown"),
        "verification": readiness.verification,
        "detail": readiness.detail,
    }
    return JSONResponse(
        content=payload,
        status_code=200 if readiness.ready else 503,
    )
