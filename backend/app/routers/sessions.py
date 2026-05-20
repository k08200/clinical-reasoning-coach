"""
Session management and Socratic coaching stream endpoint.

The SSE /stream endpoint is the core of the app — it streams Claude's Socratic response
and simultaneously analyzes student reasoning in the background.
"""
from __future__ import annotations

import uuid
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.database import get_db, AsyncSessionLocal
from app.models.case import ClinicalCase
from app.models.session import CoachingSession
from app.models.message import Message
from app.models.bias_event import BiasEvent
from app.models.token_usage import TokenUsage
from app.schemas.session import (
    SessionCreate,
    SessionResponse,
    SessionSummary,
    SendMessageRequest,
)
from app.services.socratic_coach import stream_coach_response, get_opening_message
from app.services.reasoning_analyzer import (
    analyze_student_response,
    build_reasoning_map,
)
from app.utils.auth import get_current_user_id

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _build_claude_history(messages: list[Message]) -> list[dict]:
    """Convert stored messages to Claude API format, excluding the latest student message."""
    history = []
    for msg in messages:
        if msg.role == "coach":
            history.append({"role": "assistant", "content": msg.content})
        elif msg.role == "student":
            history.append({"role": "user", "content": msg.content})
    return history


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: SessionCreate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> CoachingSession:
    """Create a coaching session and present the opening case."""
    case = await db.get(ClinicalCase, body.case_id)
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")

    session = CoachingSession(
        user_id=uuid.UUID(user_id),
        case_id=body.case_id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.flush()

    opening = get_opening_message(case)
    opening_msg = Message(
        session_id=session.id,
        role="coach",
        content=opening,
    )
    db.add(opening_msg)
    case.times_used += 1

    await db.flush()
    await db.refresh(session)
    return session


@router.get("", response_model=list[SessionSummary])
async def list_sessions(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[CoachingSession]:
    result = await db.execute(
        select(CoachingSession)
        .where(CoachingSession.user_id == uuid.UUID(user_id))
        .order_by(CoachingSession.started_at.desc())
    )
    return list(result.scalars().all())


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: uuid.UUID,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> CoachingSession:
    session = await db.get(CoachingSession, session_id)
    if not session or str(session.user_id) != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@router.post("/{session_id}/stream")
async def stream_response(
    session_id: uuid.UUID,
    body: SendMessageRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """
    Core streaming endpoint.

    1. Save student message
    2. Stream Socratic response from Claude (SSE)
    3. Background: analyze student reasoning + save results
    """
    session = await db.get(CoachingSession, session_id)
    if not session or str(session.user_id) != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session is not active",
        )

    case = await db.get(ClinicalCase, session.case_id)
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")

    # Snapshot history before adding student message
    claude_history = _build_claude_history(session.messages)
    turn_number = sum(1 for m in session.messages if m.role == "student") + 1

    # Save student message
    student_msg = Message(
        session_id=session_id,
        role="student",
        content=body.content,
    )
    db.add(student_msg)
    await db.flush()
    student_msg_id = student_msg.id
    await db.commit()

    async def event_generator():
        collected_text: list[str] = []
        collected_thinking: list[str] = []
        usage_data: dict = {}

        try:
            async for chunk in stream_coach_response(
                case=case,
                conversation_history=claude_history,
                student_message=body.content,
                turn_number=turn_number,
            ):
                if chunk.type == "thinking_start":
                    yield f"data: {json.dumps({'type': 'thinking', 'content': '...'})}\n\n"

                elif chunk.type == "thinking_delta":
                    collected_thinking.append(chunk.content)

                elif chunk.type == "text_delta":
                    collected_text.append(chunk.content)
                    yield f"data: {json.dumps({'type': 'text', 'content': chunk.content})}\n\n"

                elif chunk.type == "usage":
                    usage_data.update(chunk.usage)
                    yield f"data: {json.dumps({'type': 'usage', 'usage': chunk.usage})}\n\n"

                elif chunk.type == "done":
                    full_text = "".join(collected_text)
                    full_thinking = "".join(collected_thinking)

                    await _save_coach_turn(
                        session_id=session_id,
                        user_id=uuid.UUID(user_id),
                        case=case,
                        student_msg_id=student_msg_id,
                        student_content=body.content,
                        coach_content=full_text,
                        thinking_content=full_thinking,
                        usage=usage_data,
                        turn_number=turn_number,
                        claude_history=claude_history,
                        existing_map=session.reasoning_map,
                    )

                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    return

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{session_id}/complete", response_model=SessionResponse)
async def complete_session(
    session_id: uuid.UUID,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> CoachingSession:
    """Complete session and compute final score."""
    session = await db.get(CoachingSession, session_id)
    if not session or str(session.user_id) != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    scores = [m.reasoning_score for m in session.messages if m.reasoning_score is not None]
    final_score = sum(scores) / len(scores) if scores else 0.0

    bias_counts: dict[str, int] = {}
    for event in session.bias_events:
        bias_counts[event.bias_type] = bias_counts.get(event.bias_type, 0) + 1

    session.status = "completed"
    session.final_reasoning_score = final_score
    session.bias_summary = bias_counts
    session.completed_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(session)
    return session


async def _save_coach_turn(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    case: ClinicalCase,
    student_msg_id: uuid.UUID,
    student_content: str,
    coach_content: str,
    thinking_content: str,
    usage: dict,
    turn_number: int,
    claude_history: list[dict],
    existing_map: dict,
) -> None:
    """
    Analyze reasoning, save coach message, and update session stats.
    Uses its own DB session so stream completion can mean all turn data is durable.
    """
    async with AsyncSessionLocal() as db:
        try:
            case_summary = f"Specialty: {case.specialty}, Chief complaint: {case.chief_complaint}"
            analysis = await analyze_student_response(
                student_response=student_content,
                case_summary=case_summary,
                conversation_history=claude_history,
                turn_number=turn_number,
            )
            # Update student message with analysis
            await db.execute(
                update(Message)
                .where(Message.id == student_msg_id)
                .values(
                    reasoning_score=analysis.reasoning_score,
                    reasoning_analysis={
                        "score_breakdown": analysis.score_breakdown,
                        "strengths": analysis.student_strengths,
                        "gaps": analysis.student_gaps,
                        "coach_insight": analysis.coach_insight,
                    },
                    biases_detected=[b["type"] for b in analysis.biases_detected],
                    thinking_content=analysis.thinking_content,
                )
            )
            # Save coach message
            coach_msg = Message(
                session_id=session_id,
                role="coach",
                content=coach_content,
                thinking_content=thinking_content,
                input_tokens=int(usage.get("input_tokens", 0)),
                output_tokens=int(usage.get("output_tokens", 0)),
                thinking_tokens=int(usage.get("thinking_tokens", 0)),
            )
            db.add(coach_msg)

            # Save bias events
            for bias in analysis.biases_detected:
                if bias.get("confidence", 0) >= 0.6:
                    db.add(BiasEvent(
                        session_id=session_id,
                        user_id=user_id,
                        bias_type=bias["type"],
                        severity=bias.get("severity", "mild"),
                        evidence=bias.get("evidence", ""),
                        confidence=float(bias.get("confidence", 0.0)),
                        message_turn=turn_number,
                    ))

            # Update session
            updated_map = build_reasoning_map(
                existing_map=existing_map,
                new_node=analysis.reasoning_node,
                turn_number=turn_number,
            )

            await db.execute(
                update(CoachingSession)
                .where(CoachingSession.id == session_id)
                .values(
                    reasoning_map=updated_map,
                    total_input_tokens=CoachingSession.total_input_tokens
                    + int(usage.get("input_tokens", 0))
                    + analysis.input_tokens,
                    total_output_tokens=CoachingSession.total_output_tokens
                    + int(usage.get("output_tokens", 0))
                    + analysis.output_tokens,
                    total_thinking_tokens=CoachingSession.total_thinking_tokens
                    + int(usage.get("thinking_tokens", 0))
                    + analysis.thinking_tokens,
                )
            )

            db.add(TokenUsage(
                user_id=user_id,
                session_id=session_id,
                operation="socratic_turn",
                input_tokens=int(usage.get("input_tokens", 0)) + analysis.input_tokens,
                output_tokens=int(usage.get("output_tokens", 0)) + analysis.output_tokens,
                thinking_tokens=int(usage.get("thinking_tokens", 0)) + analysis.thinking_tokens,
            ))

            await db.commit()

        except Exception as e:
            await db.rollback()
            print(f"[ERROR] Turn save failed for session {session_id}: {e}")
            raise
