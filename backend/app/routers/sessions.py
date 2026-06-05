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
from app.models.case import (
    ClinicalCase,
    CLINICAL_REVIEW_CONTENT_FIELDS,
    clinical_case_content_fingerprint,
)
from app.models.session import CoachingSession
from app.models.message import Message
from app.models.bias_event import BiasEvent
from app.models.token_usage import TokenUsage
from app.models.safety_event import SafetyEvent
from app.models.user import User
from app.schemas.session import (
    ClinicalSafetyCoverage,
    ClinicalSafetyEvidence,
    ClinicalSafetyCoverageItem,
    SessionCreate,
    SessionReviewResponse,
    SessionResponse,
    SessionSummary,
    SendMessageRequest,
)
from app.services.socratic_coach import (
    MANAGEMENT_SAFETY_REDIRECT_RESPONSE,
    detect_management_safety_gap,
    detect_real_patient_signals,
    real_patient_safety_response_for,
    review_feedback_safety_violations,
    stream_coach_response,
    get_opening_message,
)
from app.services.privacy_guard import (
    detect_patient_identifiers,
    privacy_safety_response_for,
)
from app.services.case_quality import evaluate_case_quality
from app.services.reasoning_analyzer import (
    SCORE_DIMENSIONS,
    VALID_BIAS_SEVERITIES,
    analyze_student_response,
    build_reasoning_map,
    safe_internal_thinking_content,
    _clamp,
    _coerce_float,
)
from app.utils.auth import require_educational_use_consent

router = APIRouter(prefix="/api/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)
SAFETY_LOCKED_SESSION_STATUS = "safety_locked"
STREAM_SAFE_ERROR_MESSAGE = (
    "Coaching is temporarily unavailable. Please try again with this simulated "
    "case in a moment."
)
SESSION_REVIEW_EDUCATIONAL_NOTICE = (
    "This learning review is for simulated clinical reasoning practice only. "
    "It is not patient care, medical advice, or a substitute for local clinical "
    "protocols, supervision, emergency services, or clinician judgment."
)
SESSION_REVIEW_DIAGNOSIS_NOTICE = (
    "The diagnosis is revealed only after simulation completion for education. "
    "Do not apply it to real patients without appropriate clinical evaluation."
)
MIN_ANALYZED_LEARNER_TURNS_FOR_COMPLETION = 2
MIN_REASONING_SCORE_FOR_COMPLETION = 60.0
MIN_REASONING_DIMENSION_SCORE_FOR_COMPLETION = 12.0
HIGH_CONFIDENCE_BIAS_THRESHOLD = 0.7
SAFETY_EVIDENCE_EXCERPT_MAX_LENGTH = 220

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
    r"확인하지\s*않",
    r"평가하지\s*않",
    r"검토하지\s*않",
    r"배제하지\s*않",
    r"확인\s*안\s*했",
    r"평가\s*안\s*했",
    r"놓쳤",
    r"빠뜨렸",
]

CONTRAINDICATION_CHECK_INTENT_PATTERNS = [
    r"\baddress(?:ed|ing)?\b",
    r"\bassess(?:ed|ing)?\b",
    r"\bask(?:ed|ing)?\b",
    r"\bcheck(?:ed|ing)?\b",
    r"\bconfirm(?:ed|ing)?\b",
    r"\bconsider(?:ed|ing)?\b",
    r"\bevaluat(?:e|ed|ing|ion)\b",
    r"\bexclud(?:e|ed|ing)\b",
    r"\blook(?:ed|ing)? for\b",
    r"\breview(?:ed|ing)?\b",
    r"\brule(?:d)? out\b",
    r"\bscreen(?:ed|ing)?\b",
    r"\bverif(?:y|ied|ying)\b",
    r"확인",
    r"평가",
    r"검토",
    r"배제",
    r"감별",
    r"스크리닝",
    r"문진",
    r"물어",
    r"고려",
    r"확인하",
    r"평가하",
    r"검토하",
    r"배제하",
]

KOREAN_SAFETY_COVERAGE_ALIASES = [
    ("식은땀", ("diaphoresis",)),
    ("발한", ("diaphoresis",)),
    ("쥐어짜", ("crushing",)),
    ("압박감", ("crushing",)),
    ("흉통", ("chest", "pain")),
    ("가슴 통증", ("chest", "pain")),
    ("저산소", ("hypoxia",)),
    ("산소포화도", ("spo2", "hypoxia")),
    ("혈역학", ("hemodynamic",)),
    ("불안정", ("instability",)),
    ("심전도", ("ecg",)),
    ("12유도", ("12", "lead", "ecg")),
    ("트로포닌", ("troponin",)),
    ("연속", ("serial",)),
    ("반복", ("serial",)),
    ("추적", ("trend",)),
    ("대동맥 박리", ("aortic", "dissection")),
    ("박리", ("dissection",)),
    ("항응고", ("anticoagulant",)),
    ("항혈소판", ("antiplatelet",)),
    ("출혈", ("bleeding",)),
    ("주요 출혈", ("major", "bleeding")),
    ("심한 출혈", ("major", "bleeding")),
    ("폐색전", ("pe",)),
    ("폐색전증", ("pe",)),
    ("우심실", ("right", "ventricular", "rv")),
    ("우심장", ("right", "ventricular", "rv")),
    ("혈전용해", ("thrombolysis",)),
    ("임신", ("pregnancy",)),
    ("조영제", ("contrast",)),
    ("뇌졸중", ("stroke",)),
    ("마지막 정상", ("last", "known", "normal")),
    ("최종 정상", ("last", "known", "normal")),
    ("혈압", ("blood", "pressure", "bp")),
    ("혈당", ("glucose",)),
    ("혈소판", ("platelet",)),
    ("알테플라제", ("alteplase",)),
    ("혈전제거술", ("thrombectomy",)),
    ("패혈증", ("sepsis",)),
    ("젖산", ("lactate",)),
    ("락테이트", ("lactate",)),
    ("혈액배양", ("blood", "culture")),
    ("배양", ("culture",)),
    ("항생제", ("antibiotic",)),
    ("수액", ("fluid",)),
    ("승압제", ("vasopressor",)),
    ("감염원", ("source", "infection")),
    ("케톤산증", ("dka",)),
    ("인슐린", ("insulin",)),
    ("칼륨", ("potassium",)),
    ("포타슘", ("potassium",)),
    ("나트륨", ("sodium",)),
    ("음이온차", ("anion", "gap")),
    ("산증", ("acidosis",)),
]

SAFETY_COVERAGE_CATEGORY_LABELS = {
    "red_flags": "Red flags",
    "time_critical_actions": "Time-critical actions",
    "contraindication_checks": "Contraindication checks",
}

COGNITIVE_BIAS_LABELS = {
    "anchoring": "Anchoring",
    "premature_closure": "Premature closure",
    "availability": "Availability",
    "framing": "Framing",
    "search_satisficing": "Search satisficing",
    "commission": "Commission bias",
}

SCORE_DIMENSION_LABELS = {
    "systematic_approach": "Systematic approach",
    "evidence_integration": "Evidence integration",
    "prioritization": "Clinical prioritization",
    "mechanism_understanding": "Mechanism understanding",
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


def _append_safe_review_feedback(target: list[str], values: list[str] | None) -> None:
    for value in values or []:
        if not value or value in target:
            continue
        if review_feedback_safety_violations(value):
            continue
        target.append(value)


def _safe_review_feedback_text(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if review_feedback_safety_violations(text):
        return None
    return text


def _safe_bias_evidence_text(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        return ""
    text = value.strip()
    if review_feedback_safety_violations(text):
        return (
            "Bias evidence was withheld because it resembled actionable medical "
            "advice rather than educational reasoning feedback."
        )
    return text


def _bounded_reasoning_score(value: float) -> float:
    score = float(value)
    if score != score:
        return 0.0
    return max(0.0, min(100.0, score))


def _bounded_breakdown_value(value: object) -> float:
    return round(_clamp(_coerce_float(value, 0.0), 0.0, 25.0), 1)


def _bounded_confidence(value: object) -> float:
    return round(_clamp(_coerce_float(value, 0.0), 0.0, 1.0), 3)


def _analyzed_student_scores(messages: list[Message]) -> list[float]:
    return [
        _bounded_reasoning_score(message.reasoning_score)
        for message in messages
        if message.role == "student" and message.reasoning_score is not None
    ]


def _missing_reasoning_dimension_turns(messages: list[Message]) -> list[dict]:
    missing_turns: list[dict] = []
    for turn_number, message in enumerate(
        [message for message in messages if message.role == "student"],
        start=1,
    ):
        if message.reasoning_score is None:
            continue

        raw_breakdown = (
            message.reasoning_analysis.get("score_breakdown")
            if message.reasoning_analysis
            else None
        )
        if not isinstance(raw_breakdown, dict):
            raw_breakdown = {}

        missing_dimensions = [
            dimension
            for dimension in SCORE_DIMENSIONS
            if dimension not in raw_breakdown
        ]
        if missing_dimensions:
            missing_turns.append(
                {
                    "turn": turn_number,
                    "missing_dimensions": missing_dimensions,
                }
            )
    return missing_turns


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
        raw_breakdown = analysis.get("score_breakdown") or {}
        for dimension in SCORE_DIMENSIONS:
            if dimension not in raw_breakdown:
                continue
            value = _bounded_breakdown_value(raw_breakdown[dimension])
            score_totals[dimension] = score_totals.get(dimension, 0.0) + value
            score_counts[dimension] = score_counts.get(dimension, 0) + 1

        _append_safe_review_feedback(strengths, analysis.get("strengths"))
        _append_safe_review_feedback(gaps, analysis.get("gaps"))

        insight = _safe_review_feedback_text(analysis.get("coach_insight"))
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
                "severity": (
                    event.severity
                    if event.severity in VALID_BIAS_SEVERITIES
                    else "mild"
                ),
                "evidence": _safe_bias_evidence_text(event.evidence),
                "confidence": _bounded_confidence(event.confidence),
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
    for phrase, aliases in KOREAN_SAFETY_COVERAGE_ALIASES:
        if phrase in normalized:
            tokens.update(aliases)
    for token in re.findall(r"[a-z0-9]+", normalized):
        if len(token) < 3 and token not in {"ecg", "pe", "ct"}:
            continue
        token = token_aliases.get(token, token)
        if token not in SAFETY_COVERAGE_STOPWORDS:
            tokens.add(token)
    return tokens


def _normalize_for_safety_coverage(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _safety_coverage_clauses(text: str) -> list[str]:
    return [
        clause
        for clause in re.split(r"[.!?\n;,]+", text)
        if clause.strip()
    ]


def _is_negated_safety_mention(item_tokens: set[str], text: str) -> bool:
    if not item_tokens:
        return False

    for clause in _safety_coverage_clauses(text):
        clause_tokens = _tokens_for_safety_coverage(clause)
        if not clause_tokens.intersection(item_tokens):
            continue
        normalized_sentence = _normalize_for_safety_coverage(clause)
        if any(
            re.search(pattern, normalized_sentence)
            for pattern in SAFETY_COVERAGE_NEGATION_PATTERNS
        ):
            return True
    return False


def _has_contraindication_check_intent(item_tokens: set[str], text: str) -> bool:
    if not item_tokens:
        return False

    for clause in _safety_coverage_clauses(text):
        clause_tokens = _tokens_for_safety_coverage(clause)
        if not clause_tokens.intersection(item_tokens):
            continue
        normalized_sentence = _normalize_for_safety_coverage(clause)
        if any(
            re.search(pattern, normalized_sentence)
            for pattern in CONTRAINDICATION_CHECK_INTENT_PATTERNS
        ):
            return True
    return False


def _coverage_items_for_category(
    category: str,
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
            and (
                category != "contraindication_checks"
                or _has_contraindication_check_intent(item_tokens, turn_text)
            )
        ]
        evidence = [
            ClinicalSafetyEvidence(
                turn=turn_number,
                excerpt=_safety_evidence_excerpt(turn_text),
            )
            for turn_number, _turn_tokens, turn_text in student_turns
            if turn_number in evidence_turns
        ]
        coverage_items.append(
            ClinicalSafetyCoverageItem(
                item=item,
                covered=bool(evidence_turns),
                evidence_turns=evidence_turns,
                evidence=evidence,
            )
        )
    return coverage_items


def _safety_evidence_excerpt(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text).strip()
    if len(normalized) <= SAFETY_EVIDENCE_EXCERPT_MAX_LENGTH:
        return normalized
    return normalized[: SAFETY_EVIDENCE_EXCERPT_MAX_LENGTH - 1].rstrip() + "..."


def _build_clinical_safety_coverage(
    case: ClinicalCase,
    session: CoachingSession,
) -> ClinicalSafetyCoverage:
    return _build_clinical_safety_coverage_for_messages(
        case,
        session.messages,
        analyzed_only=True,
    )


def _build_clinical_safety_coverage_for_messages(
    case: ClinicalCase,
    messages: list[Message],
    analyzed_only: bool = False,
) -> ClinicalSafetyCoverage:
    return _build_clinical_safety_coverage_from_targets(
        red_flag_targets=case.clinical_red_flags or [],
        time_critical_action_targets=case.time_critical_actions or [],
        contraindication_check_targets=case.contraindication_checks or [],
        messages=messages,
        analyzed_only=analyzed_only,
    )


def _build_clinical_safety_coverage_from_targets(
    red_flag_targets: list[str],
    time_critical_action_targets: list[str],
    contraindication_check_targets: list[str],
    messages: list[Message],
    analyzed_only: bool = False,
) -> ClinicalSafetyCoverage:
    student_turns = [
        (index, _tokens_for_safety_coverage(message.content), message.content)
        for index, message in enumerate(
            [
                message
                for message in messages
                if message.role == "student"
                and (not analyzed_only or message.reasoning_score is not None)
            ],
            start=1,
        )
    ]
    red_flags = _coverage_items_for_category(
        "red_flags",
        red_flag_targets,
        student_turns,
    )
    time_critical_actions = _coverage_items_for_category(
        "time_critical_actions",
        time_critical_action_targets,
        student_turns,
    )
    contraindication_checks = _coverage_items_for_category(
        "contraindication_checks",
        contraindication_check_targets,
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


def _safety_review_completion_status(coverage: ClinicalSafetyCoverage) -> dict:
    uncovered_targets = _uncovered_safety_targets(coverage)
    complete = coverage.total_count == 0 or coverage.covered_count >= coverage.total_count
    if complete:
        message = (
            "All configured hidden clinical safety targets were addressed before "
            "this simulated learning review."
        )
    else:
        message = (
            "This completed session has incomplete hidden clinical safety coverage. "
            "Treat the review as incomplete educational feedback, not evidence of "
            "safe clinical readiness."
        )
    return {
        "complete": complete,
        "message": message,
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


def _minimum_reasoning_turns_block_detail(analyzed_turn_count: int) -> dict:
    return {
        "code": "minimum_reasoning_turns_incomplete",
        "message": (
            "Before finishing, complete at least two analyzed learner reasoning turns."
        ),
        "analyzed_turn_count": analyzed_turn_count,
        "minimum_turn_count": MIN_ANALYZED_LEARNER_TURNS_FOR_COMPLETION,
        "remaining_turn_count": max(
            MIN_ANALYZED_LEARNER_TURNS_FOR_COMPLETION - analyzed_turn_count,
            0,
        ),
    }


def _session_not_active_block_detail(session: CoachingSession) -> dict:
    return {
        "code": "session_not_active",
        "message": "Session is not active",
        "session_status": session.status,
    }


def _session_review_unavailable_block_detail(session: CoachingSession) -> dict:
    return {
        "code": "session_review_unavailable",
        "message": "Session review is available only after completion",
        "session_status": session.status,
        "required_status": "completed",
    }


def _session_case_missing_block_detail(session: CoachingSession) -> dict:
    return {
        "code": "session_case_missing",
        "message": (
            "This session is missing its linked clinical case. The simulation cannot "
            "continue, finish, or show a learning review until the case is restored."
        ),
        "case_id": str(session.case_id),
    }


def _reasoning_quality_block_detail(final_score: float) -> dict:
    return {
        "code": "clinical_reasoning_quality_incomplete",
        "message": (
            "Before finishing, strengthen your clinical reasoning quality with "
            "clearer differential diagnosis, evidence integration, prioritization, "
            "and mechanism explanation."
        ),
        "current_score": round(final_score, 1),
        "minimum_score": MIN_REASONING_SCORE_FOR_COMPLETION,
    }


def _management_safety_completion_gaps(
    case: ClinicalCase,
    messages: list[Message],
) -> list[dict]:
    gaps: list[dict] = []
    prior_analyzed_messages: list[Message] = []
    student_turn = 0
    for message in messages:
        if message.role != "student":
            continue
        student_turn += 1
        if message.reasoning_score is None:
            continue
        prior_coverage = _build_clinical_safety_coverage_for_messages(
            case,
            prior_analyzed_messages,
            analyzed_only=True,
        )
        uncovered_targets = _uncovered_safety_targets(prior_coverage)
        detected_terms = detect_management_safety_gap(
            message.content,
            uncovered_targets,
        )
        if detected_terms:
            gaps.append({
                "turn": student_turn,
                "detected_terms": detected_terms,
                "missing_red_flags": uncovered_targets["red_flags"],
                "missing_time_critical_actions": uncovered_targets[
                    "time_critical_actions"
                ],
                "missing_contraindication_checks": uncovered_targets[
                    "contraindication_checks"
                ],
            })
        prior_analyzed_messages.append(message)
    return gaps


def _management_safety_completion_block_detail(gaps: list[dict]) -> dict:
    return {
        "code": "management_before_safety_checks_incomplete",
        "message": (
            "Before finishing, revisit any management plan that was stated before "
            "red flags, time-critical actions, or safety checks and explain those "
            "checks first."
        ),
        "unsafe_management_turns": gaps,
    }


async def _open_safety_event_completion_block_detail(
    session_id: uuid.UUID,
    db: AsyncSession,
) -> dict | None:
    result = await db.execute(
        select(
            SafetyEvent.event_type,
            SafetyEvent.severity,
            SafetyEvent.message_turn,
            SafetyEvent.detected_terms,
        )
        .where(
            SafetyEvent.session_id == session_id,
            SafetyEvent.status == "open",
        )
        .order_by(SafetyEvent.created_at.asc(), SafetyEvent.message_turn.asc())
    )
    open_events = [
        {
            "event_type": event_type,
            "severity": severity,
            "message_turn": message_turn,
            "detected_terms": detected_terms,
        }
        for event_type, severity, message_turn, detected_terms in result.all()
    ]
    if not open_events:
        return None

    return {
        "code": "open_safety_events_unresolved",
        "message": (
            "Before finishing, resolve or review open safety events from this "
            "session. Continue the simulation only after the safety issue has "
            "been addressed."
        ),
        "open_safety_events": open_events,
    }


async def _session_safety_event_summaries(
    session_id: uuid.UUID,
    db: AsyncSession,
) -> list[dict]:
    result = await db.execute(
        select(
            SafetyEvent.event_type,
            SafetyEvent.severity,
            SafetyEvent.status,
            SafetyEvent.message_turn,
            SafetyEvent.detected_terms,
            SafetyEvent.resolution_note,
            SafetyEvent.resolved_at,
        )
        .where(SafetyEvent.session_id == session_id)
        .order_by(SafetyEvent.created_at.asc(), SafetyEvent.message_turn.asc())
    )
    return [
        {
            "event_type": event_type,
            "severity": severity,
            "status": event_status,
            "message_turn": message_turn,
            "detected_terms": detected_terms,
            "resolution_note": resolution_note,
            "resolved_at": resolved_at,
        }
        for (
            event_type,
            severity,
            event_status,
            message_turn,
            detected_terms,
            resolution_note,
            resolved_at,
        ) in result.all()
    ]


def _reasoning_dimension_averages(messages: list[Message]) -> dict[str, float]:
    score_totals: dict[str, float] = {}
    score_counts: dict[str, int] = {}

    for message in messages:
        if (
            message.role != "student"
            or message.reasoning_score is None
            or not message.reasoning_analysis
        ):
            continue
        raw_breakdown = message.reasoning_analysis.get("score_breakdown") or {}
        if not isinstance(raw_breakdown, dict):
            continue

        for dimension in SCORE_DIMENSIONS:
            if dimension not in raw_breakdown:
                continue
            score_totals[dimension] = score_totals.get(dimension, 0.0) + (
                _bounded_breakdown_value(raw_breakdown[dimension])
            )
            score_counts[dimension] = score_counts.get(dimension, 0) + 1

    return {
        dimension: round(score_totals[dimension] / score_counts[dimension], 1)
        for dimension in score_totals
        if score_counts.get(dimension)
    }


def _reasoning_dimension_block_detail(dimension_averages: dict[str, float]) -> dict:
    deficient_dimensions = [
        {
            "dimension": dimension,
            "label": SCORE_DIMENSION_LABELS.get(dimension, dimension),
            "current_score": score,
            "minimum_score": MIN_REASONING_DIMENSION_SCORE_FOR_COMPLETION,
        }
        for dimension, score in dimension_averages.items()
        if score < MIN_REASONING_DIMENSION_SCORE_FOR_COMPLETION
    ]
    return {
        "code": "clinical_reasoning_dimension_incomplete",
        "message": (
            "Before finishing, strengthen each core clinical reasoning dimension, "
            "especially prioritization, evidence integration, systematic approach, "
            "and mechanism understanding."
        ),
        "deficient_dimensions": deficient_dimensions,
    }


def _missing_reasoning_dimensions_block_detail(missing_turns: list[dict]) -> dict:
    return {
        "code": "clinical_reasoning_dimensions_unavailable",
        "message": (
            "Before finishing, complete analyzed learner turns with all core "
            "clinical reasoning dimension scores."
        ),
        "missing_turns": [
            {
                "turn": item["turn"],
                "missing_dimensions": [
                    {
                        "dimension": dimension,
                        "label": SCORE_DIMENSION_LABELS.get(dimension, dimension),
                    }
                    for dimension in item["missing_dimensions"]
                ],
            }
            for item in missing_turns
        ],
    }


def _latest_analyzed_learner_turn_number(messages: list[Message]) -> int | None:
    latest_turn_number = None
    for turn_number, message in enumerate(
        [message for message in messages if message.role == "student"],
        start=1,
    ):
        if message.reasoning_score is not None:
            latest_turn_number = turn_number
    return latest_turn_number


def _active_severe_bias_events(session: CoachingSession) -> list[BiasEvent]:
    latest_turn_number = _latest_analyzed_learner_turn_number(session.messages)
    if latest_turn_number is None:
        return []

    return [
        event
        for event in session.bias_events
        if event.message_turn == latest_turn_number
        and event.severity == "severe"
        and event.confidence >= HIGH_CONFIDENCE_BIAS_THRESHOLD
    ]


def _active_bias_block_detail(bias_events: list[BiasEvent]) -> dict:
    return {
        "code": "active_severe_cognitive_bias",
        "message": (
            "Before finishing, revisit the severe cognitive bias detected in your "
            "latest reasoning turn and explain how you would test or correct it."
        ),
        "biases": [
            {
                "bias_type": event.bias_type,
                "label": COGNITIVE_BIAS_LABELS.get(event.bias_type, event.bias_type),
                "severity": event.severity,
                "confidence": _bounded_confidence(event.confidence),
                "message_turn": event.message_turn,
            }
            for event in bias_events
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


async def _can_reviewer_read_safety_event_session_context(
    session: CoachingSession,
    user_id: str,
    db: AsyncSession,
) -> bool:
    user = await db.get(User, uuid.UUID(user_id))
    if not user or user.role not in {"clinician_reviewer", "admin"}:
        return False

    safety_event_id = await db.scalar(
        select(SafetyEvent.id)
        .where(SafetyEvent.session_id == session.id)
        .limit(1)
    )
    return bool(safety_event_id)


def _quality_payload_for_session_start(case: ClinicalCase) -> dict:
    payload = {field: getattr(case, field) for field in CLINICAL_REVIEW_CONTENT_FIELDS}
    payload["review_status"] = case.review_status
    payload["last_reviewed_at"] = case.last_reviewed_at
    return payload


SESSION_REVIEW_SNAPSHOT_FIELDS = (
    "diagnosis",
    "key_teaching_points",
    "cognitive_traps",
    "clinical_red_flags",
    "time_critical_actions",
    "contraindication_checks",
    "clinical_sources",
    "review_status",
    "last_reviewed_at",
)


def _case_review_snapshot(case: ClinicalCase) -> dict:
    snapshot = {field: getattr(case, field) for field in SESSION_REVIEW_SNAPSHOT_FIELDS}
    snapshot["case_content_fingerprint"] = clinical_case_content_fingerprint(case)
    snapshot["source_provenance"] = case.source_provenance
    snapshot["review_audit"] = _case_review_audit_snapshot(case)
    return snapshot


def _case_review_audit_snapshot(case: ClinicalCase) -> dict | None:
    latest_review = max(
        case.clinical_reviews or [],
        key=lambda review: review.created_at or datetime.min.replace(tzinfo=timezone.utc),
        default=None,
    )
    if latest_review is None:
        return None

    confirmations = (
        latest_review.confirmations
        if isinstance(latest_review.confirmations, dict)
        else {}
    )
    source_snapshot = (
        latest_review.source_snapshot
        if isinstance(latest_review.source_snapshot, dict)
        else {}
    )
    alignment_checklist = source_snapshot.get("alignment_checklist")
    source_alignment_checks = (
        alignment_checklist if isinstance(alignment_checklist, dict) else {}
    )
    return {
        "confirmations": confirmations,
        "source_alignment_checks": source_alignment_checks,
        "review_notes": latest_review.review_notes,
    }


def _session_review_snapshot(session: CoachingSession, case: ClinicalCase) -> dict:
    if isinstance(session.review_snapshot, dict) and session.review_snapshot:
        return session.review_snapshot
    return _case_review_snapshot(case)


def _assert_active_session_case_version_matches(
    session: CoachingSession,
    case: ClinicalCase,
) -> None:
    if session.status != "active":
        return
    if not isinstance(session.review_snapshot, dict):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_case_provenance_block_detail(
                code="active_session_case_snapshot_missing",
                message=(
                    "This active session has no starting case version snapshot. "
                    "Start a new session so the case version can be verified."
                ),
            ),
        )
    started_fingerprint = session.review_snapshot.get("case_content_fingerprint")
    if not started_fingerprint:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_case_provenance_block_detail(
                code="active_session_case_fingerprint_missing",
                message=(
                    "This active session has no starting case version fingerprint. "
                    "Start a new session so the case version can be verified."
                ),
            ),
        )
    if started_fingerprint == clinical_case_content_fingerprint(case):
        return

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=_case_provenance_block_detail(
            code="active_session_case_version_changed",
            message=(
                "This session was started from an earlier version of the case. "
                "Start a new session after clinician re-review to avoid mixing case versions."
            ),
        ),
    )


def _case_provenance_block_detail(*, code: str, message: str) -> dict:
    return {
        "code": code,
        "message": message,
    }


def _assert_case_provenance_allows_learner_session(case: ClinicalCase) -> None:
    source_provenance = case.source_provenance
    if source_provenance["source_count"] < 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_case_provenance_block_detail(
                code="case_source_missing",
                message=(
                    "This case has no supporting clinical source and requires "
                    "clinician review with source alignment before learner sessions can start."
                ),
            ),
        )
    if source_provenance["review_status"] != "clinician_reviewed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_case_provenance_block_detail(
                code="case_not_clinician_reviewed",
                message=(
                    "This case is not clinician reviewed. Learner sessions are blocked "
                    "until clinician review confirms clinical accuracy, source alignment, "
                    "and educational safety."
                ),
            ),
        )
    if source_provenance["review_content_changed"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_case_provenance_block_detail(
                code="case_review_content_changed",
                message=(
                    "This case changed after clinician review and requires re-review "
                    "before learner sessions can start."
                ),
            ),
        )
    if source_provenance["review_date_invalid"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_case_provenance_block_detail(
                code="case_review_date_invalid",
                message=(
                    "This case has an invalid clinician review date and requires "
                    "updated clinical review before learner sessions can start."
                ),
            ),
        )
    if source_provenance["review_stale"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_case_provenance_block_detail(
                code="case_review_stale",
                message=(
                    "This case has a stale clinician review and requires updated "
                    "clinical review before learner sessions can start."
                ),
            ),
        )
    if source_provenance["review_audit_missing"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_case_provenance_block_detail(
                code="case_review_audit_missing",
                message=(
                    "This case is marked clinician reviewed but has no review audit "
                    "fingerprint. Learner sessions are blocked until clinician re-review."
                ),
            ),
        )
    if source_provenance["review_audit_incomplete"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_case_provenance_block_detail(
                code="case_review_audit_incomplete",
                message=(
                    "This case is marked clinician reviewed but its review audit is "
                    "incomplete. Learner sessions are blocked until clinician re-review "
                    "confirms clinical accuracy, source alignment, and educational safety."
                ),
            ),
        )
    if source_provenance["source_diversity_insufficient"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_case_provenance_block_detail(
                code="case_source_diversity_insufficient",
                message=(
                    "Clinician-reviewed cases require at least 2 independent clinical "
                    "source organizations before learner sessions can start."
                ),
            ),
        )


def _assert_case_quality_for_learner_session(case: ClinicalCase) -> None:
    quality_report = evaluate_case_quality(_quality_payload_for_session_start(case))
    if quality_report.passed:
        return

    issues = quality_report.critical_issues + quality_report.warnings
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "case_quality_gate_blocked",
            "message": "Case quality gate blocks learner sessions",
            "issues": issues,
        },
    )


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
    if not body.acknowledge_educational_simulation:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Acknowledge that this is an educational simulation, not patient "
                "care or medical advice, before starting a session."
            ),
        )
    _assert_case_provenance_allows_learner_session(case)
    _assert_case_quality_for_learner_session(case)

    session = CoachingSession(
        user_id=uuid.UUID(user_id),
        case_id=body.case_id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_case_review_snapshot(case),
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
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if str(session.user_id) != user_id and not await _can_reviewer_read_safety_event_session_context(
        session,
        user_id,
        db,
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@router.get("/{session_id}/review", response_model=SessionReviewResponse)
async def get_session_review(
    session_id: uuid.UUID,
    user_id: str = Depends(require_educational_use_consent),
    db: AsyncSession = Depends(get_db),
) -> SessionReviewResponse:
    session = await db.get(CoachingSession, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if str(session.user_id) != user_id and not await _can_reviewer_read_safety_event_session_context(
        session,
        user_id,
        db,
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_session_review_unavailable_block_detail(session),
        )

    case = await db.get(ClinicalCase, session.case_id)
    if not case:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_session_case_missing_block_detail(session),
        )

    review_snapshot = _session_review_snapshot(session, case)
    feedback = _build_review_feedback(session)
    clinical_safety_coverage = _build_clinical_safety_coverage_from_targets(
        red_flag_targets=review_snapshot.get("clinical_red_flags") or [],
        time_critical_action_targets=review_snapshot.get("time_critical_actions") or [],
        contraindication_check_targets=review_snapshot.get("contraindication_checks") or [],
        messages=session.messages,
        analyzed_only=True,
    )
    safety_events = await _session_safety_event_summaries(session.id, db)

    return SessionReviewResponse(
        session_id=session.id,
        case_id=case.id,
        educational_notice=SESSION_REVIEW_EDUCATIONAL_NOTICE,
        diagnosis_notice=SESSION_REVIEW_DIAGNOSIS_NOTICE,
        diagnosis=review_snapshot.get("diagnosis") or case.diagnosis,
        score_breakdown=feedback["score_breakdown"],
        strengths=feedback["strengths"],
        gaps=feedback["gaps"],
        coach_insights=feedback["coach_insights"],
        bias_feedback=feedback["bias_feedback"],
        key_teaching_points=review_snapshot.get("key_teaching_points") or [],
        cognitive_traps=review_snapshot.get("cognitive_traps") or [],
        clinical_sources=review_snapshot.get("clinical_sources") or [],
        safety_events=safety_events,
        clinical_safety_coverage=clinical_safety_coverage,
        clinical_safety_completion=_safety_review_completion_status(
            clinical_safety_coverage
        ),
        source_provenance=case.source_provenance,
        review_audit=review_snapshot.get("review_audit"),
        review_status=review_snapshot.get("review_status") or case.review_status,
        last_reviewed_at=review_snapshot.get("last_reviewed_at"),
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
            detail=_session_not_active_block_detail(session),
        )

    turn_number = sum(1 for m in session.messages if m.role == "student") + 1

    patient_identifiers = detect_patient_identifiers(body.content)
    if patient_identifiers:
        privacy_response = privacy_safety_response_for(body.content)

        async def privacy_event_generator():
            await _save_privacy_safety_turn(
                session_id=session_id,
                user_id=uuid.UUID(user_id),
                detected_identifier_categories=patient_identifiers,
                turn_number=turn_number,
                response_content=privacy_response,
            )
            yield f"data: {json.dumps({'type': 'text', 'content': privacy_response})}\n\n"
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
    if real_patient_signals:
        safety_response = real_patient_safety_response_for(body.content)

        async def real_patient_event_generator():
            await _save_real_patient_safety_turn(
                session_id=session_id,
                user_id=uuid.UUID(user_id),
                coach_content=safety_response,
                detected_terms=real_patient_signals,
                turn_number=turn_number,
            )
            yield f"data: {json.dumps({'type': 'text', 'content': safety_response})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        return StreamingResponse(
            real_patient_event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    case = await db.get(ClinicalCase, session.case_id)
    if not case:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_session_case_missing_block_detail(session),
        )
    _assert_case_provenance_allows_learner_session(case)
    _assert_active_session_case_version_matches(session, case)
    _assert_case_quality_for_learner_session(case)

    # Snapshot history before adding any new message
    claude_history = _build_claude_history(session.messages)

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
    management_safety_gap_terms = detect_management_safety_gap(
        body.content,
        uncovered_safety_targets,
    )
    await db.commit()

    async def event_generator():
        if management_safety_gap_terms:
            await _save_management_safety_redirect_turn(
                session_id=session_id,
                user_id=uuid.UUID(user_id),
                detected_terms=management_safety_gap_terms,
                uncovered_safety_targets=uncovered_safety_targets,
                turn_number=turn_number,
            )
            yield f"data: {json.dumps({'type': 'text', 'content': MANAGEMENT_SAFETY_REDIRECT_RESPONSE})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        collected_text: list[str] = []
        collected_thinking: list[str] = []
        coach_guardrail_violations: list[str] = []
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

                elif chunk.type == "safety_guardrail":
                    coach_guardrail_violations = [
                        item.strip()
                        for item in chunk.content.split(",")
                        if item.strip()
                    ]

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
                        coach_guardrail_violations=coach_guardrail_violations,
                    )

                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    return

        except Exception:
            logger.exception("Stream failed for session %s", session_id)
            yield f"data: {json.dumps({'type': 'error', 'message': STREAM_SAFE_ERROR_MESSAGE})}\n\n"

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
            action_taken="locked_session_blocked_storage_and_coaching",
            detected_terms=detected_terms,
            message_turn=turn_number,
            note=(
                "Session was locked; student message storage, coaching, and "
                "reasoning analysis were skipped for a possible real patient or "
                "emergency scenario."
            ),
        ))
        await db.commit()


async def _save_privacy_safety_turn(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    detected_identifier_categories: list[str],
    turn_number: int,
    response_content: str,
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
            content=response_content,
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


async def _save_management_safety_redirect_turn(
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    detected_terms: list[str],
    uncovered_safety_targets: dict[str, list[str]],
    turn_number: int,
) -> None:
    missing_sections = [
        f"{label}: {', '.join(uncovered_safety_targets.get(category) or [])}"
        for category, label in [
            ("red_flags", "red flags"),
            ("time_critical_actions", "time-critical actions"),
            ("contraindication_checks", "contraindication checks"),
        ]
        if uncovered_safety_targets.get(category)
    ]
    missing_summary = "; ".join(missing_sections) or "documented safety targets"
    async with AsyncSessionLocal() as db:
        db.add(Message(
            session_id=session_id,
            role="coach",
            content=MANAGEMENT_SAFETY_REDIRECT_RESPONSE,
        ))
        db.add(SafetyEvent(
            session_id=session_id,
            user_id=user_id,
            event_type="management_before_safety_checks",
            severity="medium",
            action_taken="coach_redirected_to_safety_checks",
            detected_terms=detected_terms,
            message_turn=turn_number,
            note=(
                "Learner committed to simulated management before addressing "
                f"{missing_summary}."
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
            detail=_session_not_active_block_detail(session),
        )

    open_safety_event_detail = await _open_safety_event_completion_block_detail(
        session_id,
        db,
    )
    if open_safety_event_detail:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=open_safety_event_detail,
        )

    scores = _analyzed_student_scores(session.messages)
    if not scores:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_minimum_reasoning_turns_block_detail(0),
        )

    case = await db.get(ClinicalCase, session.case_id)
    if not case:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_session_case_missing_block_detail(session),
        )
    _assert_case_provenance_allows_learner_session(case)
    _assert_active_session_case_version_matches(session, case)
    _assert_case_quality_for_learner_session(case)
    safety_coverage = _build_clinical_safety_coverage(case, session)
    if safety_coverage.total_count and (
        safety_coverage.covered_count < safety_coverage.total_count
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_safety_completion_block_detail(safety_coverage),
        )
    management_safety_gaps = _management_safety_completion_gaps(
        case,
        session.messages,
    )
    if management_safety_gaps:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_management_safety_completion_block_detail(management_safety_gaps),
        )
    if len(scores) < MIN_ANALYZED_LEARNER_TURNS_FOR_COMPLETION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_minimum_reasoning_turns_block_detail(len(scores)),
        )

    final_score = sum(scores) / len(scores)
    if final_score < MIN_REASONING_SCORE_FOR_COMPLETION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_reasoning_quality_block_detail(final_score),
        )
    missing_dimension_turns = _missing_reasoning_dimension_turns(session.messages)
    if missing_dimension_turns:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_missing_reasoning_dimensions_block_detail(missing_dimension_turns),
        )
    dimension_averages = _reasoning_dimension_averages(session.messages)
    if any(
        score < MIN_REASONING_DIMENSION_SCORE_FOR_COMPLETION
        for score in dimension_averages.values()
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_reasoning_dimension_block_detail(dimension_averages),
        )
    active_bias_events = _active_severe_bias_events(session)
    if active_bias_events:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_active_bias_block_detail(active_bias_events),
        )

    bias_counts: dict[str, int] = {}
    for event in session.bias_events:
        bias_counts[event.bias_type] = bias_counts.get(event.bias_type, 0) + 1

    session.status = "completed"
    session.final_reasoning_score = final_score
    session.bias_summary = bias_counts
    session.review_snapshot = _case_review_snapshot(case)
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
    coach_guardrail_violations: list[str] | None = None,
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
                    thinking_content=safe_internal_thinking_content(
                        analysis.thinking_content
                    ),
                )
            )
            # Save coach message
            coach_msg = Message(
                session_id=session_id,
                role="coach",
                content=coach_content,
                thinking_content=safe_internal_thinking_content(thinking_content),
                input_tokens=int(usage.get("input_tokens", 0)),
                output_tokens=int(usage.get("output_tokens", 0)),
                thinking_tokens=int(usage.get("thinking_tokens", 0)),
            )
            db.add(coach_msg)

            if coach_guardrail_violations:
                db.add(SafetyEvent(
                    session_id=session_id,
                    user_id=user_id,
                    event_type="unsafe_coach_output_guardrail",
                    severity="medium",
                    action_taken="unsafe_model_output_replaced_before_delivery",
                    detected_terms=coach_guardrail_violations,
                    message_turn=turn_number,
                    note=(
                        "The model attempted unsafe simulated coaching output. "
                        "It was replaced with the safe guardrail response before "
                        "delivery and should be reviewed before session completion."
                    ),
                ))

            # Save bias events
            for bias in analysis.biases_detected:
                if bias.get("confidence", 0) >= 0.6:
                    db.add(BiasEvent(
                        session_id=session_id,
                        user_id=user_id,
                        bias_type=bias["type"],
                        severity=bias.get("severity", "mild"),
                        evidence=_safe_bias_evidence_text(bias.get("evidence", "")),
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
