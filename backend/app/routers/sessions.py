"""
Session management and Socratic coaching stream endpoint.

The SSE /stream endpoint is the core of the app — it streams Claude's Socratic response
and simultaneously analyzes student reasoning in the background.
"""
from __future__ import annotations

import uuid
import json
import logging
import re
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
from app.models.safety_event import SafetyEvent
from app.schemas.session import (
    ClinicalSafetyCoverage,
    ClinicalSafetyCoverageItem,
    SessionCreate,
    SessionReviewResponse,
    SessionResponse,
    SessionSummary,
    SendMessageRequest,
)
from app.services.socratic_coach import (
    REAL_PATIENT_SAFETY_RESPONSE,
    detect_real_patient_signals,
    stream_coach_response,
    get_opening_message,
)
from app.services.privacy_guard import (
    PHI_SAFETY_RESPONSE,
    detect_patient_identifiers,
)
from app.services.reasoning_analyzer import (
    analyze_student_response,
    build_reasoning_map,
)
from app.utils.auth import require_educational_use_consent

router = APIRouter(prefix="/api/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)
SAFETY_LOCKED_SESSION_STATUS = "safety_locked"

SAFETY_COVERAGE_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "before",
    "after",
    "from",
    "that",
    "this",
    "patient",
    "patients",
    "clinical",
    "features",
    "feature",
    "checks",
    "check",
    "action",
    "actions",
    "risk",
    "risks",
    "need",
    "needs",
    "should",
    "would",
    "could",
    "must",
    "rule",
    "out",
}

SAFETY_COVERAGE_NEGATION_PATTERNS = [
    r"\b(no|not|never)\b",
    r"\bdidn'?t\b",
    r"\bdid not\b",
    r"\bhaven'?t\b",
    r"\bhave not\b",
    r"\bhasn'?t\b",
    r"\bhas not\b",
    r"\bwithout\b",
    r"\bforgot\b",
    r"\bmissed\b",
    r"\bfailed to\b",
    r"\bdid not assess\b",
    r"\bdid not check\b",
]

SAFETY_COVERAGE_CATEGORY_LABELS = {
    "red_flags": "Red flags",
    "time_critical_actions": "Time-critical actions",
    "contraindication_checks": "Contraindication checks",
}


def _build_claude_history(messages: list[Message]) -> list[dict]:
    """Convert stored messages to Claude API format, excluding the latest student message."""
    history = []
    for msg in messages:
        if msg.role == "coach":
            history.append({"role": "assistant", "content": msg.content})
        elif msg.role == "student":
            history.append({"role": "user", "content": msg.content})
    return history


def _append_unique(target: list[str], values: list[str] | None) -> None:
    for value in values or []:
        if value and value not in target:
            target.append(value)


def _build_review_feedback(session: CoachingSession) -> dict:
    score_totals: dict[str, float] = {}
    score_counts: dict[str, int] = {}
    strengths: list[str] = []
    gaps: list[str] = []
    coach_insights: list[str] = []

    for message in session.messages:
        if message.role != "student" or not message.reasoning_analysis:
            continue

        analysis = message.reasoning_analysis
        for dimension, value in (analysis.get("score_breakdown") or {}).items():
            score_totals[dimension] = score_totals.get(dimension, 0.0) + float(value)
            score_counts[dimension] = score_counts.get(dimension, 0) + 1

        _append_unique(strengths, analysis.get("strengths"))
        _append_unique(gaps, analysis.get("gaps"))

        insight = analysis.get("coach_insight")
        if insight and insight not in coach_insights:
            coach_insights.append(insight)

    return {
        "score_breakdown": {
            dimension: round(total / score_counts[dimension], 1)
            for dimension, total in score_totals.items()
        },
        "strengths": strengths,
        "gaps": gaps,
        "coach_insights": coach_insights,
        "bias_feedback": [
            {
                "bias_type": event.bias_type,
                "severity": event.severity,
                "evidence": event.evidence,
                "confidence": event.confidence,
                "message_turn": event.message_turn,
            }
            for event in sorted(session.bias_events, key=lambda event: event.message_turn)
        ],
    }


def _tokens_for_safety_coverage(text: str) -> set[str]:
    normalized = text.lower()
    token_aliases = {
        "electrocardiogram": "ecg",
        "ekg": "ecg",
        "anticoagulation": "anticoagulant",
        "anticoagulated": "anticoagulant",
        "antiplatelets": "antiplatelet",
        "antibiotics": "antibiotic",
        "cultures": "culture",
        "allergies": "allergy",
    }
    tokens = set()
    for token in re.findall(r"[a-z0-9]+", normalized):
        if len(token) < 3 and token not in {"ecg", "pe", "ct"}:
            continue
        token = token_aliases.get(token, token)
        if token not in SAFETY_COVERAGE_STOPWORDS:
            tokens.add(token)
    return tokens


def _normalize_for_safety_coverage(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _is_negated_safety_mention(item_tokens: set[str], text: str) -> bool:
    if not item_tokens:
        return False

    for sentence in re.split(r"[.!?\n;]+", text):
        sentence_tokens = _tokens_for_safety_coverage(sentence)
        if not sentence_tokens.intersection(item_tokens):
            continue
        normalized_sentence = _normalize_for_safety_coverage(sentence)
        if any(
            re.search(pattern, normalized_sentence)
            for pattern in SAFETY_COVERAGE_NEGATION_PATTERNS
        ):
            return True
    return False


def _coverage_items_for_category(
    items: list[str],
    student_turns: list[tuple[int, set[str], str]],
) -> list[ClinicalSafetyCoverageItem]:
    coverage_items: list[ClinicalSafetyCoverageItem] = []
    for item in items:
        item_tokens = _tokens_for_safety_coverage(item)
        required_overlap = 1 if len(item_tokens) <= 1 else 2
        evidence_turns = [
            turn_number
            for turn_number, turn_tokens, turn_text in student_turns
            if len(item_tokens.intersection(turn_tokens)) >= required_overlap
            and not _is_negated_safety_mention(item_tokens, turn_text)
        ]
        coverage_items.append(
            ClinicalSafetyCoverageItem(
                item=item,
                covered=bool(evidence_turns),
                evidence_turns=evidence_turns,
            )
        )
    return coverage_items


def _build_clinical_safety_coverage(
    case: ClinicalCase,
    session: CoachingSession,
) -> ClinicalSafetyCoverage:
    return _build_clinical_safety_coverage_for_messages(case, session.messages)


def _build_clinical_safety_coverage_for_messages(
    case: ClinicalCase,
    messages: list[Message],
) -> ClinicalSafetyCoverage:
    student_turns = [
        (index, _tokens_for_safety_coverage(message.content), message.content)
        for index, message in enumerate(
            [message for message in messages if message.role == "student"],
            start=1,
        )
    ]
    red_flags = _coverage_items_for_category(case.clinical_red_flags or [], student_turns)
    time_critical_actions = _coverage_items_for_category(
        case.time_critical_actions or [],
        student_turns,
    )
    contraindication_checks = _coverage_items_for_category(
        case.contraindication_checks or [],
        student_turns,
    )
    all_items = red_flags + time_critical_actions + contraindication_checks

    return ClinicalSafetyCoverage(
        red_flags=red_flags,
        time_critical_actions=time_critical_actions,
        contraindication_checks=contraindication_checks,
        covered_count=sum(1 for item in all_items if item.covered),
        total_count=len(all_items),
    )


def _uncovered_safety_targets(
    coverage: ClinicalSafetyCoverage,
) -> dict[str, list[str]]:
    return {
        "red_flags": [
            item.item for item in coverage.red_flags if not item.covered
        ],
        "time_critical_actions": [
            item.item for item in coverage.time_critical_actions if not item.covered
        ],
        "contraindication_checks": [
            item.item for item in coverage.contraindication_checks if not item.covered
        ],
    }


def _safety_completion_block_detail(coverage: ClinicalSafetyCoverage) -> dict:
    uncovered_targets = _uncovered_safety_targets(coverage)
    return {
        "code": "clinical_safety_coverage_incomplete",
        "message": (
            "Before finishing, address red flags, time-critical actions, and "
            "contraindication checks in your reasoning."
        ),
        "covered_count": coverage.covered_count,
        "total_count": coverage.total_count,
        "uncovered_categories": [
            {
                "category": category,
                "label": SAFETY_COVERAGE_CATEGORY_LABELS[category],
                "missing_count": len(items),
            }
            for category, items in uncovered_targets.items()
            if items
        ],
    }


def _messages_with_current_turn(
    session: CoachingSession,
    student_msg: Message,
) -> list[Message]:
    messages_by_id = {
        message.id: message
        for message in [*session.messages, student_msg]
        if message.id is not None
    }
    return list(messages_by_id.values())


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: SessionCreate,
    user_id: str = Depends(require_educational_use_consent),
    db: AsyncSession = Depends(get_db),
) -> CoachingSession:
    """Create a coaching session and present the opening case."""
    case = await db.get(ClinicalCase, body.case_id)
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    source_provenance = case.source_provenance
    if source_provenance["requires_caution"] and not body.acknowledge_unreviewed_case:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This case is not currently clinician reviewed. Set "
                "acknowledge_unreviewed_case=true to use it for educational simulation."
            ),
        )

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
    user_id: str = Depends(require_educational_use_consent),
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
    user_id: str = Depends(require_educational_use_consent),
    db: AsyncSession = Depends(get_db),
) -> CoachingSession:
    session = await db.get(CoachingSession, session_id)
    if not session or str(session.user_id) != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@router.get("/{session_id}/review", response_model=SessionReviewResponse)
async def get_session_review(
    session_id: uuid.UUID,
    user_id: str = Depends(require_educational_use_consent),
    db: AsyncSession = Depends(get_db),
) -> SessionReviewResponse:
    session = await db.get(CoachingSession, session_id)
    if not session or str(session.user_id) != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Session review is available only after completion",
        )

    case = await db.get(ClinicalCase, session.case_id)
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")

    feedback = _build_review_feedback(session)

    return SessionReviewResponse(
        session_id=session.id,
        case_id=case.id,
        diagnosis=case.diagnosis,
        score_breakdown=feedback["score_breakdown"],
        strengths=feedback["strengths"],
        gaps=feedback["gaps"],
        coach_insights=feedback["coach_insights"],
        bias_feedback=feedback["bias_feedback"],
        key_teaching_points=case.key_teaching_points,
        cognitive_traps=case.cognitive_traps,
        clinical_sources=case.clinical_sources,
        clinical_safety_coverage=_build_clinical_safety_coverage(case, session),
        review_status=case.review_status,
        last_reviewed_at=case.last_reviewed_at,
    )


@router.post("/{session_id}/stream")
async def stream_response(
    session_id: uuid.UUID,
    body: SendMessageRequest,
    user_id: str = Depends(require_educational_use_consent),
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

    # Snapshot history before adding any new message
    claude_history = _build_claude_history(session.messages)
    turn_number = sum(1 for m in session.messages if m.role == "student") + 1

    patient_identifiers = detect_patient_identifiers(body.content)
    if patient_identifiers:
        async def privacy_event_generator():
            await _save_privacy_safety_turn(
                session_id=session_id,
                user_id=uuid.UUID(user_id),
                detected_identifier_categories=patient_identifiers,
                turn_number=turn_number,
            )
            yield f"data: {json.dumps({'type': 'text', 'content': PHI_SAFETY_RESPONSE})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        return StreamingResponse(
            privacy_event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    real_patient_signals = detect_real_patient_signals(body.content)

    # Save student message
    student_msg = Message(
        session_id=session_id,
        role="student",
        content=body.content,
    )
    db.add(student_msg)
    await db.flush()
    student_msg_id = student_msg.id
    safety_coverage = _build_clinical_safety_coverage_for_messages(
        case,
        _messages_with_current_turn(session, student_msg),
    )
    uncovered_safety_targets = _uncovered_safety_targets(safety_coverage)
    await db.commit()

    async def event_generator():
        if real_patient_signals:
            await _save_real_patient_safety_turn(
                session_id=session_id,
                user_id=uuid.UUID(user_id),
                coach_content=REAL_PATIENT_SAFETY_RESPONSE,
                detected_terms=real_patient_signals,
                turn_number=turn_number,
            )
            yield f"data: {json.dumps({'type': 'text', 'content': REAL_PATIENT_SAFETY_RESPONSE})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        collected_text: list[str] = []
        collected_thinking: list[str] = []
        usage_data: dict = {}

        try:
            async for chunk in stream_coach_response(
                case=case,
                conversation_history=claude_history,
                student_message=body.content,
                turn_number=turn_number,
                uncovered_safety_targets=uncovered_safety_targets,
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


async def _save_real_patient_safety_turn(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    coach_content: str,
    detected_terms: list[str],
    turn_number: int,
) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(CoachingSession)
            .where(CoachingSession.id == session_id)
            .values(status=SAFETY_LOCKED_SESSION_STATUS)
        )
        db.add(Message(
            session_id=session_id,
            role="coach",
            content=coach_content,
        ))
        db.add(SafetyEvent(
            session_id=session_id,
            user_id=user_id,
            event_type="real_patient_or_emergency_signal",
            severity="high",
            action_taken="locked_session_and_halted_coaching",
            detected_terms=detected_terms,
            message_turn=turn_number,
            note=(
                "Session was locked; coaching and reasoning analysis were skipped "
                "for a possible real patient or emergency scenario."
            ),
        ))
        await db.commit()


async def _save_privacy_safety_turn(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    detected_identifier_categories: list[str],
    turn_number: int,
) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(CoachingSession)
            .where(CoachingSession.id == session_id)
            .values(status=SAFETY_LOCKED_SESSION_STATUS)
        )
        db.add(Message(
            session_id=session_id,
            role="coach",
            content=PHI_SAFETY_RESPONSE,
        ))
        db.add(SafetyEvent(
            session_id=session_id,
            user_id=user_id,
            event_type="possible_patient_identifier",
            severity="high",
            action_taken="locked_session_blocked_storage_and_coaching",
            detected_terms=detected_identifier_categories,
            message_turn=turn_number,
            note=(
                "Session was locked; student message was not stored or sent to the "
                "model because it appeared to contain patient identifiers."
            ),
        ))
        await db.commit()


@router.post("/{session_id}/complete", response_model=SessionResponse)
async def complete_session(
    session_id: uuid.UUID,
    user_id: str = Depends(require_educational_use_consent),
    db: AsyncSession = Depends(get_db),
) -> CoachingSession:
    """Complete session and compute final score."""
    session = await db.get(CoachingSession, session_id)
    if not session or str(session.user_id) != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session is not active",
        )

    scores = [m.reasoning_score for m in session.messages if m.reasoning_score is not None]
    if not scores:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one analyzed learner response is required before completion",
        )

    case = await db.get(ClinicalCase, session.case_id)
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    safety_coverage = _build_clinical_safety_coverage(case, session)
    if safety_coverage.total_count and (
        safety_coverage.covered_count < safety_coverage.total_count
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_safety_completion_block_detail(safety_coverage),
        )

    final_score = sum(scores) / len(scores)

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
            logger.exception("Turn save failed for session %s", session_id)
            raise
