from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers import sessions as sessions_router
from app.models.bias_event import BiasEvent
from app.models.case import ClinicalCase
from app.models.message import Message
from app.models.safety_event import SafetyEvent
from app.models.session import CoachingSession
from app.models.user import User
from app.services.provider import StreamChunk
from app.services.reasoning_analyzer import ReasoningAnalysis
from app.utils.auth import create_access_token, hash_password
from tests.conftest import TestSessionLocal


async def fake_stream_coach_response(**_kwargs) -> AsyncGenerator[StreamChunk, None]:
    yield StreamChunk(type="thinking_start")
    yield StreamChunk(type="text_delta", content="What finding would most change your differential?")
    yield StreamChunk(
        type="usage",
        usage={"input_tokens": 12, "output_tokens": 18, "thinking_tokens": 4},
    )
    yield StreamChunk(type="done")


async def fake_analyze_student_response(**_kwargs) -> ReasoningAnalysis:
    return ReasoningAnalysis(
        reasoning_score=82,
        score_breakdown={
            "systematic_approach": 21,
            "evidence_integration": 20,
            "prioritization": 22,
            "mechanism_understanding": 19,
        },
        biases_detected=[
            {
                "type": "anchoring",
                "severity": "mild",
                "evidence": "Student focused on ACS first.",
                "confidence": 0.7,
            }
        ],
        reasoning_node={
            "hypothesis": "ACS versus other dangerous chest pain causes",
            "supporting_evidence": ["crushing chest pain", "diaphoresis"],
            "missing_evidence": ["ECG", "serial troponin"],
            "reasoning_quality": "systematic",
        },
        coach_insight="Student is prioritizing dangerous diagnoses.",
        student_strengths=["Prioritizes life-threatening causes"],
        student_gaps=["Needs explicit disconfirming evidence"],
        thinking_content="[test analysis]",
        input_tokens=7,
        output_tokens=11,
        thinking_tokens=3,
    )


def _make_case(review_status: str = "educational_draft") -> ClinicalCase:
    return ClinicalCase(
        title="Chest Pain Case",
        specialty="internal_medicine",
        difficulty="medium",
        chief_complaint="Chest pain",
        patient_demographics={"age": 58, "sex": "male"},
        history_of_present_illness="Crushing chest pain with diaphoresis.",
        past_medical_history="Hypertension",
        medications=["lisinopril"],
        physical_exam={
            "vitals": {"bp": "150/90", "hr": 96, "rr": 18, "temp_c": 37.0, "spo2": 96},
            "general": "Diaphoretic",
            "cardiovascular": "Regular rhythm",
            "pulmonary": "Clear",
            "abdomen": "Soft",
            "neuro": "Alert",
        },
        initial_labs={"troponin": "borderline"},
        diagnosis="Acute coronary syndrome",
        key_teaching_points=["Obtain ECG early in acute chest pain"],
        cognitive_traps=["Anchoring"],
        clinical_sources=[
            {
                "title": "Chest Pain Guideline",
                "organization": "Cardiology Society",
                "url": "https://example.org/chest-pain",
                "supports": ["ECG timing", "risk stratification"],
            }
        ],
        review_status=review_status,
        last_reviewed_at="2026-06-01" if review_status != "ai_generated_unreviewed" else None,
        coach_guidance="Use Socratic questioning.",
    )


@pytest.mark.asyncio
async def test_create_session_requires_acknowledgement_for_unreviewed_case(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"unreviewed-session-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Unreviewed Session Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="educational_draft")
    db.add_all([user, case])
    await db.commit()
    await db.refresh(user)
    await db.refresh(case)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        "/api/sessions",
        json={"case_id": str(case.id)},
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert "not clinician reviewed" in response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0


@pytest.mark.asyncio
async def test_create_session_allows_clinician_reviewed_case_without_acknowledgement(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"reviewed-session-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Reviewed Session Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.commit()
    await db.refresh(user)
    await db.refresh(case)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        "/api/sessions",
        json={"case_id": str(case.id)},
        headers=auth_headers,
    )

    assert response.status_code == 201
    assert response.json()["case_id"] == str(case.id)
    await db.refresh(case)
    assert case.times_used == 1


@pytest.mark.asyncio
async def test_stream_response_persists_turn_before_done(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(
        sessions_router,
        "stream_coach_response",
        fake_stream_coach_response,
    )
    monkeypatch.setattr(
        sessions_router,
        "analyze_student_response",
        fake_analyze_student_response,
    )

    email = f"session-{uuid.uuid4()}@test.com"
    register_response = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "sessionpass123",
            "full_name": "Session Tester",
            "training_level": "resident",
            "accepted_educational_use": True,
        },
    )
    assert register_response.status_code == 201

    login_response = await client.post(
        "/api/auth/token",
        data={"username": email, "password": "sessionpass123"},
    )
    assert login_response.status_code == 200
    auth_headers = {
        "Authorization": f"Bearer {login_response.json()['access_token']}",
    }

    case_response = await client.post("/api/cases/generate/demo", headers=auth_headers)
    assert case_response.status_code == 201
    case_id = case_response.json()["id"]

    session_response = await client.post(
        "/api/sessions",
        json={"case_id": case_id, "acknowledge_unreviewed_case": True},
        headers=auth_headers,
    )
    assert session_response.status_code == 201
    session_id = session_response.json()["id"]

    stream_response = await client.post(
        f"/api/sessions/{session_id}/stream",
        json={"content": "I am considering ACS but also want ECG and serial troponin."},
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert '"type": "text"' in stream_response.text
    assert '"type": "done"' in stream_response.text

    saved_response = await client.get(
        f"/api/sessions/{session_id}",
        headers=auth_headers,
    )
    assert saved_response.status_code == 200
    saved_session = saved_response.json()

    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "student",
        "coach",
    ]
    assert saved_session["messages"][1]["reasoning_score"] == 82
    assert saved_session["messages"][1]["biases_detected"] == ["anchoring"]
    assert saved_session["messages"][2]["content"] == (
        "What finding would most change your differential?"
    )
    assert saved_session["reasoning_map"]["nodes"][0]["hypothesis"] == (
        "ACS versus other dangerous chest pain causes"
    )
    assert saved_session["total_input_tokens"] == 19
    assert saved_session["total_output_tokens"] == 29
    assert saved_session["total_thinking_tokens"] == 7


@pytest.mark.asyncio
async def test_real_patient_signal_halts_coaching_and_records_safety_event(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("LLM coaching should not run for real-patient signals")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Reasoning analysis should not run for real-patient signals")

    monkeypatch.setattr(
        sessions_router,
        "stream_coach_response",
        fail_stream_coach_response,
    )
    monkeypatch.setattr(
        sessions_router,
        "analyze_student_response",
        fail_analyze_student_response,
    )

    email = f"safety-{uuid.uuid4()}@test.com"
    register_response = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "safetypass123",
            "full_name": "Safety Tester",
            "training_level": "resident",
            "accepted_educational_use": True,
        },
    )
    assert register_response.status_code == 201
    login_response = await client.post(
        "/api/auth/token",
        data={"username": email, "password": "safetypass123"},
    )
    auth_headers = {
        "Authorization": f"Bearer {login_response.json()['access_token']}",
    }

    case_response = await client.post("/api/cases/generate/demo", headers=auth_headers)
    session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": case_response.json()["id"],
            "acknowledge_unreviewed_case": True,
        },
        headers=auth_headers,
    )
    session_id = session_response.json()["id"]

    stream_response = await client.post(
        f"/api/sessions/{session_id}/stream",
        json={"content": "My patient has severe chest pain right now and cannot breathe."},
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert "I cannot continue coaching" in stream_response.text
    assert '"type": "done"' in stream_response.text

    saved_response = await client.get(
        f"/api/sessions/{session_id}",
        headers=auth_headers,
    )
    saved_session = saved_response.json()
    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "student",
        "coach",
    ]
    assert saved_session["messages"][1]["reasoning_score"] is None
    assert "I cannot continue coaching" in saved_session["messages"][2]["content"]
    assert saved_session["reasoning_map"]["nodes"] == []
    assert saved_session["total_input_tokens"] == 0
    assert saved_session["total_output_tokens"] == 0
    assert saved_session["total_thinking_tokens"] == 0

    async with TestSessionLocal() as db:
        safety_events = (
            await db.execute(
                select(SafetyEvent).where(
                    SafetyEvent.session_id == uuid.UUID(session_id)
                )
            )
        ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].action_taken == "halted_coaching"
    assert "severe chest pain" in safety_events[0].detected_terms


@pytest.mark.asyncio
async def test_patient_identifier_signal_blocks_storage_and_records_safety_event(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("LLM coaching should not run when identifiers are present")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Reasoning analysis should not run when identifiers are present")

    monkeypatch.setattr(
        sessions_router,
        "stream_coach_response",
        fail_stream_coach_response,
    )
    monkeypatch.setattr(
        sessions_router,
        "analyze_student_response",
        fail_analyze_student_response,
    )

    email = f"privacy-{uuid.uuid4()}@test.com"
    register_response = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "privacypass123",
            "full_name": "Privacy Tester",
            "training_level": "resident",
            "accepted_educational_use": True,
        },
    )
    assert register_response.status_code == 201
    login_response = await client.post(
        "/api/auth/token",
        data={"username": email, "password": "privacypass123"},
    )
    auth_headers = {
        "Authorization": f"Bearer {login_response.json()['access_token']}",
    }

    case_response = await client.post("/api/cases/generate/demo", headers=auth_headers)
    session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": case_response.json()["id"],
            "acknowledge_unreviewed_case": True,
        },
        headers=auth_headers,
    )
    session_id = session_response.json()["id"]

    stream_response = await client.post(
        f"/api/sessions/{session_id}/stream",
        json={
            "content": (
                "Patient name is John Smith, DOB 01/02/1970, "
                "MRN A123456, and phone 555-123-4567."
            ),
        },
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert "patient identifiers" in stream_response.text
    assert '"type": "done"' in stream_response.text

    saved_response = await client.get(
        f"/api/sessions/{session_id}",
        headers=auth_headers,
    )
    saved_session = saved_response.json()
    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "coach",
    ]
    assert "John Smith" not in str(saved_session)
    assert "A123456" not in str(saved_session)
    assert "555-123-4567" not in str(saved_session)

    async with TestSessionLocal() as db:
        safety_events = (
            await db.execute(
                select(SafetyEvent).where(
                    SafetyEvent.session_id == uuid.UUID(session_id)
                )
            )
        ).scalars().all()
        messages = (
            await db.execute(
                select(Message).where(Message.session_id == uuid.UUID(session_id))
            )
        ).scalars().all()

    assert len(safety_events) == 1
    assert safety_events[0].event_type == "possible_patient_identifier"
    assert safety_events[0].action_taken == "blocked_storage_and_coaching"
    assert safety_events[0].detected_terms == [
        "phone_number",
        "medical_record_number",
        "date_of_birth",
        "full_date",
        "name_identifier",
    ]
    assert "John Smith" not in str(safety_events[0].detected_terms)
    assert [message.role for message in messages] == ["coach", "coach"]


@pytest.mark.asyncio
async def test_session_review_available_only_after_completion(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"review-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Review Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.flush()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }
    case = ClinicalCase(
        title="Chest Pain Case",
        specialty="internal_medicine",
        difficulty="medium",
        chief_complaint="Chest pain",
        patient_demographics={"age": 58, "sex": "male"},
        history_of_present_illness="Crushing chest pain with diaphoresis.",
        past_medical_history="Hypertension",
        medications=["lisinopril"],
        physical_exam={
            "vitals": {"bp": "150/90", "hr": 96, "rr": 18, "temp_c": 37.0, "spo2": 96},
            "general": "Diaphoretic",
            "cardiovascular": "Regular rhythm",
            "pulmonary": "Clear",
            "abdomen": "Soft",
            "neuro": "Alert",
        },
        initial_labs={"troponin": "borderline"},
        diagnosis="Acute coronary syndrome",
        key_teaching_points=["Obtain ECG early in acute chest pain"],
        cognitive_traps=["Anchoring"],
        clinical_sources=[
            {
                "title": "Chest Pain Guideline",
                "organization": "Cardiology Society",
                "url": "https://example.org/chest-pain",
                "supports": ["ECG timing", "risk stratification"],
            }
        ],
        review_status="educational_draft",
        last_reviewed_at="2026-06-01",
        coach_guidance="Use Socratic questioning.",
    )
    db.add(case)
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content="I prioritized ACS and PE.",
        reasoning_score=82,
        reasoning_analysis={
            "score_breakdown": {
                "systematic_approach": 21,
                "evidence_integration": 19,
                "prioritization": 23,
                "mechanism_understanding": 17,
            },
            "strengths": ["Prioritized dangerous diagnoses"],
            "gaps": ["Needs more disconfirming evidence"],
            "coach_insight": "Good initial safety framing.",
        },
        biases_detected=["anchoring"],
    ))
    db.add(BiasEvent(
        session_id=session.id,
        user_id=user.id,
        bias_type="anchoring",
        severity="mild",
        evidence="Focused on ACS before explicitly considering alternatives.",
        confidence=0.72,
        message_turn=1,
    ))
    await db.commit()

    blocked_response = await client.get(
        f"/api/sessions/{session.id}/review",
        headers=auth_headers,
    )
    assert blocked_response.status_code == 403

    session.status = "completed"
    session.final_reasoning_score = 82
    await db.commit()

    review_response = await client.get(
        f"/api/sessions/{session.id}/review",
        headers=auth_headers,
    )
    assert review_response.status_code == 200
    payload = review_response.json()
    assert payload["diagnosis"] == "Acute coronary syndrome"
    assert payload["score_breakdown"] == {
        "systematic_approach": 21.0,
        "evidence_integration": 19.0,
        "prioritization": 23.0,
        "mechanism_understanding": 17.0,
    }
    assert payload["strengths"] == ["Prioritized dangerous diagnoses"]
    assert payload["gaps"] == ["Needs more disconfirming evidence"]
    assert payload["coach_insights"] == ["Good initial safety framing."]
    assert payload["bias_feedback"] == [
        {
            "bias_type": "anchoring",
            "severity": "mild",
            "evidence": "Focused on ACS before explicitly considering alternatives.",
            "confidence": 0.72,
            "message_turn": 1,
        }
    ]
    assert payload["key_teaching_points"] == ["Obtain ECG early in acute chest pain"]
    assert payload["cognitive_traps"] == ["Anchoring"]
    assert payload["clinical_sources"] == [
        {
            "title": "Chest Pain Guideline",
            "organization": "Cardiology Society",
            "url": "https://example.org/chest-pain",
            "supports": ["ECG timing", "risk stratification"],
        }
    ]
    assert payload["review_status"] == "educational_draft"
    assert "coach_guidance" not in payload
