from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.database import get_db
from app.models.safety_event import SafetyEvent
from app.models.session import CoachingSession
from app.models.user import User
from app.schemas.safety import (
    MIN_RESOLUTION_NOTE_LENGTH,
    RESOLUTION_NOTE_REVIEW_TERMS,
    VALID_SAFETY_EVENT_SEVERITIES,
    VALID_SAFETY_EVENT_STATUSES,
    VALID_SAFETY_EVENT_TYPES,
    SafetyEventResolutionRequest,
    SafetyEventResponse,
)
from app.utils.auth import require_safety_reviewer

router = APIRouter(prefix="/api/safety-events", tags=["safety"])

HIGH_RISK_LOCK_EVENT_TYPES = {
    "possible_patient_identifier",
    "real_patient_or_emergency_signal",
}
HIGH_RISK_RESOLUTION_TERMS = {
    "de-identified",
    "emergency",
    "escalated",
    "local protocol",
    "not patient care",
    "outside the app",
    "privacy",
    "program director",
    "supervising",
    "supervisor",
    "개인정보",
    "개인 정보",
    "기관 프로토콜",
    "보고",
    "비식별",
    "상급자",
    "슈퍼바이저",
    "앱 밖",
    "원내 프로토콜",
    "응급",
    "지도",
    "지도전문의",
    "진료 아님",
    "환자 진료 아님",
}


def _validate_safety_event_filter(
    field: str,
    value: str | None,
    allowed_values: set[str],
) -> None:
    if value is None or value in allowed_values:
        return

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": "invalid_safety_event_filter",
            "field": field,
            "allowed_values": sorted(allowed_values),
        },
    )


def _validate_high_risk_resolution_note(
    event: SafetyEvent,
    resolution_note: str | None,
) -> None:
    if (
        event.severity != "high"
        or event.event_type not in HIGH_RISK_LOCK_EVENT_TYPES
    ):
        return

    note = (resolution_note or "").lower()
    if any(term in note for term in HIGH_RISK_RESOLUTION_TERMS):
        return

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": "high_risk_safety_resolution_note_incomplete",
            "message": (
                "High-risk real patient, emergency, or privacy events require "
                "documentation of escalation, supervision, privacy handling, local "
                "protocol use, or that the app was not used for patient care."
            ),
            "required_terms": sorted(HIGH_RISK_RESOLUTION_TERMS),
        },
    )


def _resolution_note_block_detail(
    *,
    code: str,
    message: str,
    **extra: object,
) -> dict:
    return {
        "code": code,
        "message": message,
        **extra,
    }


def _validate_resolution_note(resolution_note: str | None) -> str:
    note = (resolution_note or "").strip()
    if not note:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=_resolution_note_block_detail(
                code="safety_resolution_note_required",
                message="Resolution note is required before marking an event resolved.",
            ),
        )
    if len(note) < MIN_RESOLUTION_NOTE_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=_resolution_note_block_detail(
                code="safety_resolution_note_too_short",
                message="Resolution note must summarize the safety review or escalation.",
                minimum_length=MIN_RESOLUTION_NOTE_LENGTH,
            ),
        )
    if not any(term in note.lower() for term in RESOLUTION_NOTE_REVIEW_TERMS):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=_resolution_note_block_detail(
                code="safety_resolution_note_context_missing",
                message=(
                    "Resolution note must mention review, escalation, or how the "
                    "issue was addressed."
                ),
                required_terms=sorted(RESOLUTION_NOTE_REVIEW_TERMS),
            ),
        )
    return note


def _safety_event_response(
    event: SafetyEvent,
    user_email: str,
    user_full_name: str,
    case_id: uuid.UUID,
    session_status: str,
    resolved_by_email: str | None = None,
    resolved_by_full_name: str | None = None,
) -> SafetyEventResponse:
    return SafetyEventResponse(
        id=event.id,
        session_id=event.session_id,
        case_id=case_id,
        session_status=session_status,
        user_id=event.user_id,
        user_email=user_email,
        user_full_name=user_full_name,
        event_type=event.event_type,
        severity=event.severity,
        action_taken=event.action_taken,
        detected_terms=event.detected_terms,
        message_turn=event.message_turn,
        note=event.note,
        status=event.status,
        resolution_note=event.resolution_note,
        resolved_at=event.resolved_at,
        resolved_by_user_id=event.resolved_by_user_id,
        resolved_by_user_email=resolved_by_email,
        resolved_by_user_full_name=resolved_by_full_name,
        created_at=event.created_at,
    )


@router.get("", response_model=list[SafetyEventResponse])
async def list_safety_events(
    event_type: str | None = Query(None),
    severity: str | None = Query(None),
    event_status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _reviewer: User = Depends(require_safety_reviewer),
    db: AsyncSession = Depends(get_db),
) -> list[SafetyEventResponse]:
    _validate_safety_event_filter("event_type", event_type, VALID_SAFETY_EVENT_TYPES)
    _validate_safety_event_filter("severity", severity, VALID_SAFETY_EVENT_SEVERITIES)
    _validate_safety_event_filter("event_status", event_status, VALID_SAFETY_EVENT_STATUSES)

    resolved_by_user = aliased(User)
    query = (
        select(
            SafetyEvent,
            User.email,
            User.full_name,
            CoachingSession.case_id,
            CoachingSession.status,
            resolved_by_user.email,
            resolved_by_user.full_name,
        )
        .join(User, SafetyEvent.user_id == User.id)
        .join(CoachingSession, SafetyEvent.session_id == CoachingSession.id)
        .outerjoin(resolved_by_user, SafetyEvent.resolved_by_user_id == resolved_by_user.id)
    )
    if event_type:
        query = query.where(SafetyEvent.event_type == event_type)
    if severity:
        query = query.where(SafetyEvent.severity == severity)
    if event_status:
        query = query.where(SafetyEvent.status == event_status)

    query = (
        query.order_by(SafetyEvent.created_at.desc(), SafetyEvent.message_turn.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = await db.execute(query)

    return [
        _safety_event_response(
            event,
            email,
            full_name,
            case_id,
            session_status,
            resolved_by_email,
            resolved_by_full_name,
        )
        for (
            event,
            email,
            full_name,
            case_id,
            session_status,
            resolved_by_email,
            resolved_by_full_name,
        ) in rows.all()
    ]


@router.patch("/{event_id}/resolution", response_model=SafetyEventResponse)
async def update_safety_event_resolution(
    event_id: uuid.UUID,
    body: SafetyEventResolutionRequest,
    reviewer: User = Depends(require_safety_reviewer),
    db: AsyncSession = Depends(get_db),
) -> SafetyEventResponse:
    event = await db.get(SafetyEvent, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "safety_event_not_found",
                "message": "Safety event not found",
            },
        )

    resolution_note = None
    if body.status == "resolved":
        resolution_note = _validate_resolution_note(body.resolution_note)
        _validate_high_risk_resolution_note(event, resolution_note)

    event.status = body.status
    if body.status == "resolved":
        event.resolution_note = resolution_note
        event.resolved_at = datetime.now(timezone.utc)
        event.resolved_by_user_id = reviewer.id
    else:
        event.resolution_note = None
        event.resolved_at = None
        event.resolved_by_user_id = None

    await db.flush()

    result = await db.execute(
        select(
            SafetyEvent,
            User.email,
            User.full_name,
            CoachingSession.case_id,
            CoachingSession.status,
        )
        .join(User, SafetyEvent.user_id == User.id)
        .join(CoachingSession, SafetyEvent.session_id == CoachingSession.id)
        .where(SafetyEvent.id == event.id)
    )
    saved_event, user_email, user_full_name, case_id, session_status = result.one()
    resolved_by_email = reviewer.email if saved_event.resolved_by_user_id else None
    resolved_by_full_name = reviewer.full_name if saved_event.resolved_by_user_id else None

    return _safety_event_response(
        saved_event,
        user_email,
        user_full_name,
        case_id,
        session_status,
        resolved_by_email,
        resolved_by_full_name,
    )
