from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bias_event import BiasEvent
from app.models.case import ClinicalCase
from app.models.message import Message
from app.models.session import CoachingSession
from app.models.token_usage import TokenUsage
from app.models.user import User
from app.utils.auth import create_access_token, hash_password


def make_auth_headers(user_id: uuid.UUID) -> dict[str, str]:
    token = create_access_token({"sub": str(user_id)})
    return {"Authorization": f"Bearer {token}"}


async def create_user(db: AsyncSession) -> User:
    user = User(
        email=f"analytics-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("analyticspass123"),
        full_name="Analytics Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.flush()
    return user


def make_case(**overrides) -> ClinicalCase:
    data = {
        "title": "Chest Pain Case",
        "specialty": "internal_medicine",
        "difficulty": "medium",
        "chief_complaint": "Chest pain",
        "patient_demographics": {"age": 58, "sex": "male"},
        "history_of_present_illness": "Crushing chest pain with diaphoresis.",
        "past_medical_history": "Hypertension",
        "medications": ["lisinopril"],
        "physical_exam": {
            "vitals": {"bp": "150/90", "hr": 96, "rr": 18, "temp_c": 37.0, "spo2": 96},
            "general": "Diaphoretic",
            "cardiovascular": "Regular rhythm",
            "pulmonary": "Clear",
            "abdomen": "Soft",
            "neuro": "Alert",
        },
        "initial_labs": {"troponin": "borderline"},
        "diagnosis": "ACS",
        "key_teaching_points": ["ECG within 10 minutes"],
        "cognitive_traps": ["Anchoring"],
        "coach_guidance": "Ask about dangerous causes first.",
    }
    data.update(overrides)
    return ClinicalCase(**data)


@pytest.mark.asyncio
async def test_get_my_analytics_empty_state(
    client: AsyncClient,
    db: AsyncSession,
):
    user = await create_user(db)
    await db.commit()

    response = await client.get("/api/analytics/me", headers=make_auth_headers(user.id))

    assert response.status_code == 200
    data = response.json()
    assert data["total_sessions"] == 0
    assert data["completed_sessions"] == 0
    assert data["total_messages"] == 0
    assert data["avg_reasoning_score"] == 0.0
    assert data["bias_patterns"] == []
    assert data["reasoning_trend"] == []
    assert data["total_tokens_used"] == 0
    assert data["specialty_performance"] == {}


@pytest.mark.asyncio
async def test_get_my_analytics_aggregates_completed_sessions(
    client: AsyncClient,
    db: AsyncSession,
):
    user = await create_user(db)
    clinical_case = make_case()
    db.add(clinical_case)
    await db.flush()

    completed_session = CoachingSession(
        user_id=user.id,
        case_id=clinical_case.id,
        status="completed",
        final_reasoning_score=80,
        reasoning_map={"nodes": [], "edges": []},
        bias_summary={"anchoring": 2},
        total_input_tokens=50,
        total_output_tokens=30,
        total_thinking_tokens=20,
    )
    active_session = CoachingSession(
        user_id=user.id,
        case_id=clinical_case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add_all([completed_session, active_session])
    await db.flush()

    db.add_all([
        Message(
            session_id=completed_session.id,
            role="coach",
            content="Opening case",
        ),
        Message(
            session_id=completed_session.id,
            role="student",
            content="I would consider ACS and PE.",
            reasoning_score=80,
            reasoning_analysis={
                "score_breakdown": {
                    "systematic_approach": 22,
                    "evidence_integration": 12,
                    "prioritization": 20,
                    "mechanism_understanding": 10,
                }
            },
            biases_detected=["anchoring"],
        ),
        Message(
            session_id=completed_session.id,
            role="coach",
            content="What evidence would change your differential?",
        ),
        BiasEvent(
            session_id=completed_session.id,
            user_id=user.id,
            bias_type="anchoring",
            severity="mild",
            evidence="Focused on ACS first.",
            confidence=0.7,
            message_turn=1,
        ),
        BiasEvent(
            session_id=completed_session.id,
            user_id=user.id,
            bias_type="anchoring",
            severity="moderate",
            evidence="Did not disconfirm ACS.",
            confidence=0.9,
            message_turn=2,
        ),
        TokenUsage(
            user_id=user.id,
            session_id=completed_session.id,
            operation="socratic_turn",
            input_tokens=50,
            output_tokens=30,
            thinking_tokens=20,
        ),
    ])
    await db.commit()

    response = await client.get("/api/analytics/me", headers=make_auth_headers(user.id))

    assert response.status_code == 200
    data = response.json()
    assert data["total_sessions"] == 2
    assert data["completed_sessions"] == 1
    assert data["total_messages"] == 3
    assert data["avg_reasoning_score"] == 80
    assert data["total_tokens_used"] == 100
    assert data["specialty_performance"] == {"internal_medicine": 80.0}
    assert data["reasoning_trend"] == [
        {
            "session_number": 1,
            "avg_score": 80.0,
            "date": completed_session.started_at.isoformat(),
        }
    ]
    assert data["bias_patterns"] == [
        {
            "bias_type": "anchoring",
            "count": 2,
            "severity_distribution": {"mild": 1, "moderate": 1},
            "avg_confidence": 0.8,
        }
    ]
    assert data["strongest_areas"] == ["Systematic approach", "Prioritization"]
    assert data["weakest_areas"] == ["Evidence integration", "Mechanism understanding"]
