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
from app.schemas.safety import SafetyEventResolutionRequest, SafetyEventResponse
from app.utils.auth import require_clinical_reviewer

router = APIRouter(prefix="/api/safety-events", tags=["safety"])


def _safety_event_response(
    event: SafetyEvent,
    user_email: str,
    user_full_name: str,
    case_id: uuid.UUID,
    resolved_by_email: str | None = None,
    resolved_by_full_name: str | None = None,
) -> SafetyEventResponse:
    return SafetyEventResponse(
        id=event.id,
        session_id=event.session_id,
        case_id=case_id,
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
    _reviewer: User = Depends(require_clinical_reviewer),
    db: AsyncSession = Depends(get_db),
) -> list[SafetyEventResponse]:
    resolved_by_user = aliased(User)
    query = (
        select(
            SafetyEvent,
            User.email,
            User.full_name,
            CoachingSession.case_id,
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
            resolved_by_email,
            resolved_by_full_name,
        )
        for event, email, full_name, case_id, resolved_by_email, resolved_by_full_name in rows.all()
    ]


@router.patch("/{event_id}/resolution", response_model=SafetyEventResponse)
async def update_safety_event_resolution(
    event_id: uuid.UUID,
    body: SafetyEventResolutionRequest,
    reviewer: User = Depends(require_clinical_reviewer),
    db: AsyncSession = Depends(get_db),
) -> SafetyEventResponse:
    event = await db.get(SafetyEvent, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Safety event not found",
        )

    event.status = body.status
    event.resolution_note = body.resolution_note.strip() if body.resolution_note else None
    if body.status == "resolved":
        event.resolved_at = datetime.now(timezone.utc)
        event.resolved_by_user_id = reviewer.id
    else:
        event.resolved_at = None
        event.resolved_by_user_id = None

    await db.flush()

    result = await db.execute(
        select(
            SafetyEvent,
            User.email,
            User.full_name,
            CoachingSession.case_id,
        )
        .join(User, SafetyEvent.user_id == User.id)
        .join(CoachingSession, SafetyEvent.session_id == CoachingSession.id)
        .where(SafetyEvent.id == event.id)
    )
    saved_event, user_email, user_full_name, case_id = result.one()
    resolved_by_email = reviewer.email if saved_event.resolved_by_user_id else None
    resolved_by_full_name = reviewer.full_name if saved_event.resolved_by_user_id else None

    return _safety_event_response(
        saved_event,
        user_email,
        user_full_name,
        case_id,
        resolved_by_email,
        resolved_by_full_name,
    )
