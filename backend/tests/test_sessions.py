from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

import pytest
from httpx import AsyncClient

from app.routers import sessions as sessions_router
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
