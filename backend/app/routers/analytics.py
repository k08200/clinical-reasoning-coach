from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.session import CoachingSession
from app.models.message import Message
from app.models.bias_event import BiasEvent
from app.models.token_usage import TokenUsage
from app.schemas.analytics import UserAnalytics, BiasPattern, ReasoningTrend
from app.services.reasoning_analyzer import (
    SCORE_DIMENSIONS,
    VALID_BIAS_SEVERITIES,
    _clamp,
    _coerce_float,
)
from app.utils.auth import require_educational_use_consent

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _bounded_reasoning_score(value: object) -> float:
    return round(_clamp(_coerce_float(value, 0.0), 0.0, 100.0), 1)


def _bounded_breakdown_value(value: object) -> float:
    return round(_clamp(_coerce_float(value, 0.0), 0.0, 25.0), 1)


def _bounded_confidence(value: object) -> float:
    return round(_clamp(_coerce_float(value, 0.0), 0.0, 1.0), 3)


@router.get("/me", response_model=UserAnalytics)
async def get_my_analytics(
    user_id: str = Depends(require_educational_use_consent),
    db: AsyncSession = Depends(get_db),
) -> UserAnalytics:
    uid = uuid.UUID(user_id)

    # Sessions — eager-load case for specialty lookup
    sessions_result = await db.execute(
        select(CoachingSession)
        .options(selectinload(CoachingSession.case))
        .where(CoachingSession.user_id == uid)
        .order_by(CoachingSession.started_at.asc())
    )
    sessions = list(sessions_result.scalars().all())

    completed = [s for s in sessions if s.status == "completed"]
    scores = [
        _bounded_reasoning_score(s.final_reasoning_score)
        for s in completed
        if s.final_reasoning_score is not None
    ]
    avg_score = sum(scores) / len(scores) if scores else 0.0

    # Bias patterns
    bias_result = await db.execute(
        select(BiasEvent).where(BiasEvent.user_id == uid)
    )
    all_biases = list(bias_result.scalars().all())

    bias_map: dict[str, dict] = {}
    for b in all_biases:
        if b.bias_type not in bias_map:
            bias_map[b.bias_type] = {"count": 0, "severity_distribution": {}, "confidences": []}
        bias_map[b.bias_type]["count"] += 1
        severity = b.severity if b.severity in VALID_BIAS_SEVERITIES else "mild"
        bias_map[b.bias_type]["severity_distribution"][severity] = (
            bias_map[b.bias_type]["severity_distribution"].get(severity, 0) + 1
        )
        bias_map[b.bias_type]["confidences"].append(_bounded_confidence(b.confidence))

    bias_patterns = [
        BiasPattern(
            bias_type=bt,
            count=data["count"],
            severity_distribution=data["severity_distribution"],
            avg_confidence=round(sum(data["confidences"]) / len(data["confidences"]), 3),
        )
        for bt, data in bias_map.items()
    ]
    bias_patterns.sort(key=lambda x: x.count, reverse=True)

    # Reasoning trend (last 10 sessions)
    trend = [
        ReasoningTrend(
            session_number=i + 1,
            avg_score=_bounded_reasoning_score(s.final_reasoning_score),
            date=s.started_at.isoformat(),
        )
        for i, s in enumerate(completed[-10:])
    ]

    # Token totals
    token_result = await db.execute(
        select(func.sum(TokenUsage.input_tokens + TokenUsage.output_tokens + TokenUsage.thinking_tokens))
        .where(TokenUsage.user_id == uid)
    )
    total_tokens = token_result.scalar() or 0

    # Specialty performance — use real case specialty via eager-loaded relationship
    specialty_scores: dict[str, list[float]] = {}
    for s in completed:
        if s.final_reasoning_score is not None:
            sp = s.case.specialty if s.case else "unknown"
            specialty_scores.setdefault(sp, []).append(
                _bounded_reasoning_score(s.final_reasoning_score)
            )

    specialty_performance = {
        sp: round(sum(sc) / len(sc), 1) for sp, sc in specialty_scores.items()
    }

    # Strongest areas — aggregate score_breakdown across student messages
    breakdown_totals: dict[str, list[float]] = {}
    total_messages = 0
    for s in sessions:
        for m in s.messages:
            total_messages += 1
            if m.role == "student" and m.reasoning_analysis:
                raw_breakdown = m.reasoning_analysis.get("score_breakdown") or {}
                for dim in SCORE_DIMENSIONS:
                    if dim in raw_breakdown:
                        breakdown_totals.setdefault(dim, []).append(
                            _bounded_breakdown_value(raw_breakdown[dim])
                        )

    _DIMENSION_LABELS = {
        "systematic_approach": "Systematic approach",
        "evidence_integration": "Evidence integration",
        "prioritization": "Prioritization",
        "mechanism_understanding": "Mechanism understanding",
    }
    if breakdown_totals:
        avg_dims = {
            _DIMENSION_LABELS.get(k, k): round(sum(v) / len(v), 1)
            for k, v in breakdown_totals.items()
        }
        sorted_dims = sorted(avg_dims.items(), key=lambda x: x[1], reverse=True)
        strongest_areas = [label for label, _ in sorted_dims[:2] if _ >= 15]
        weakest_areas = [label for label, _ in sorted_dims[-2:] if _ < 15]
    else:
        strongest_areas = []
        weakest_areas = [b.bias_type for b in bias_patterns[:2]]

    return UserAnalytics(
        user_id=uid,
        total_sessions=len(sessions),
        completed_sessions=len(completed),
        total_messages=total_messages,
        avg_reasoning_score=avg_score,
        bias_patterns=bias_patterns,
        reasoning_trend=trend,
        total_tokens_used=int(total_tokens),
        strongest_areas=strongest_areas,
        weakest_areas=weakest_areas or [b.bias_type for b in bias_patterns[:2]],
        specialty_performance=specialty_performance,
    )
