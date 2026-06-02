from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.safety_event import SafetyEvent
from app.models.session import CoachingSession
from app.models.user import User
from app.schemas.safety import SafetyEventResponse
from app.utils.auth import require_clinical_reviewer

router = APIRouter(prefix="/api/safety-events", tags=["safety"])


@router.get("", response_model=list[SafetyEventResponse])
async def list_safety_events(
    event_type: str | None = Query(None),
    severity: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _reviewer: User = Depends(require_clinical_reviewer),
    db: AsyncSession = Depends(get_db),
) -> list[SafetyEventResponse]:
    query = (
        select(
            SafetyEvent,
            User.email,
            User.full_name,
            CoachingSession.case_id,
        )
        .join(User, SafetyEvent.user_id == User.id)
        .join(CoachingSession, SafetyEvent.session_id == CoachingSession.id)
    )
    if event_type:
        query = query.where(SafetyEvent.event_type == event_type)
    if severity:
        query = query.where(SafetyEvent.severity == severity)

    query = (
        query.order_by(SafetyEvent.created_at.desc(), SafetyEvent.message_turn.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = await db.execute(query)

    return [
        SafetyEventResponse(
            id=event.id,
            session_id=event.session_id,
            case_id=case_id,
            user_id=event.user_id,
            user_email=email,
            user_full_name=full_name,
            event_type=event.event_type,
            severity=event.severity,
            action_taken=event.action_taken,
            detected_terms=event.detected_terms,
            message_turn=event.message_turn,
            note=event.note,
            created_at=event.created_at,
        )
        for event, email, full_name, case_id in rows.all()
    ]
