from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.routers import sessions as sessions_router
from app.models.safety_event import SafetyEvent
from app.services.provider import StreamChunk
from app.services.reasoning_analyzer import ReasoningAnalysis
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
        json={"case_id": case_id},
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
        json={"case_id": case_response.json()["id"]},
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
