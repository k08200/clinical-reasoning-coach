from __future__ import annotations

import json
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers import sessions as sessions_router
from app.models.bias_event import BiasEvent
from app.models.case import ClinicalCase, clinical_case_content_fingerprint
from app.models.case_review import ClinicalCaseReview
from app.models.message import Message
from app.models.safety_event import SafetyEvent
from app.models.session import CoachingSession
from app.models.user import User
from app.schemas.session import MAX_STUDENT_MESSAGE_LENGTH
from app.services.provider import StreamChunk
from app.services.reasoning_analyzer import ReasoningAnalysis
from app.services.socratic_coach import KOREAN_REAL_PATIENT_SAFETY_RESPONSE
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


def _passing_reasoning_analysis() -> dict:
    return {
        "score_breakdown": {
            "systematic_approach": 21,
            "evidence_integration": 20,
            "prioritization": 22,
            "mechanism_understanding": 19,
        },
    }


COMPLETE_ACS_SAFETY_REASONING = (
    "I need to address diaphoresis with crushing chest pain plus hypoxia "
    "or hemodynamic instability. I would obtain a 12-lead ECG within "
    "10 minutes, trend serial troponin, activate the ACS reperfusion pathway "
    "if STEMI criteria are present, plan antiplatelet and anticoagulation "
    "after contraindication checks, check for aortic dissection features "
    "before anticoagulation, assess major bleeding risk and recent major "
    "surgery before antiplatelet therapy, and escalate hemodynamic instability, "
    "heart failure, or pulmonary edema."
)


KOREAN_COMPLETE_ACS_SAFETY_REASONING = (
    "식은땀을 동반한 쥐어짜는 흉통과 저산소증 또는 혈역학적 불안정을 "
    "위험 신호로 보고, 10분 이내 12유도 심전도와 반복 트로포닌 추적을 "
    "하겠습니다. STEMI 기준이면 ACS reperfusion pathway를 활성화하고, "
    "금기 확인 뒤 antiplatelet 및 anticoagulation 계획을 세우겠습니다. "
    "항응고 전 aortic dissection, 항혈소판 치료 전 major bleeding risk와 "
    "recent surgery를 확인하고, hemodynamic instability나 heart failure "
    "또는 pulmonary edema는 상급 처치로 escalate하겠습니다. I will check "
    "Aortic dissection features before anticoagulation, Major bleeding risk "
    "before antiplatelet therapy, Recent major surgery before antithrombotic "
    "therapy, and check Hemodynamic instability, heart failure, or pulmonary "
    "edema requiring escalation."
)


def _review_audit_for_case(case: ClinicalCase) -> ClinicalCaseReview:
    return ClinicalCaseReview(
        case=case,
        reviewer_user_id=uuid.uuid4(),
        prior_review_status="educational_draft",
        resulting_review_status="clinician_reviewed",
        confirmations={
            "clinical_accuracy_confirmed": True,
            "source_alignment_confirmed": True,
            "educational_safety_confirmed": True,
        },
        source_snapshot={
            "source_count": len(case.clinical_sources or []),
            "organizations": [
                source.get("organization")
                for source in case.clinical_sources or []
                if source.get("organization")
            ],
            "case_content_fingerprint": clinical_case_content_fingerprint(case),
            "alignment_checklist": {
                "teaching_points_supported": True,
                "red_flags_supported": True,
                "time_critical_actions_supported": True,
                "contraindication_checks_supported": True,
            },
        },
        review_notes="Test clinician review with source and safety alignment.",
    )


def _refresh_review_fingerprint_for_test(case: ClinicalCase) -> None:
    assert case.clinical_reviews
    review = case.clinical_reviews[0]
    review.source_snapshot = {
        **review.source_snapshot,
        "case_content_fingerprint": clinical_case_content_fingerprint(case),
    }


def _review_audit_snapshot_for_case(case: ClinicalCase) -> dict | None:
    clinical_reviews = case.__dict__.get("clinical_reviews") or []
    if not clinical_reviews:
        return None
    review = clinical_reviews[0]
    source_snapshot = review.source_snapshot if isinstance(review.source_snapshot, dict) else {}
    alignment_checklist = source_snapshot.get("alignment_checklist")
    return {
        "confirmations": review.confirmations,
        "source_alignment_checks": (
            alignment_checklist if isinstance(alignment_checklist, dict) else {}
        ),
        "review_notes": review.review_notes,
    }


def _session_review_snapshot_for_case(case: ClinicalCase) -> dict:
    organizations = [
        source.get("organization")
        for source in case.clinical_sources or []
        if source.get("organization")
    ]
    review_status = case.review_status
    review_label = (
        "Clinician reviewed"
        if review_status == "clinician_reviewed"
        else "AI-generated, unreviewed"
        if review_status == "ai_generated_unreviewed"
        else "Educational draft"
    )
    return {
        "diagnosis": case.diagnosis,
        "key_teaching_points": case.key_teaching_points,
        "cognitive_traps": case.cognitive_traps,
        "clinical_red_flags": case.clinical_red_flags,
        "time_critical_actions": case.time_critical_actions,
        "contraindication_checks": case.contraindication_checks,
        "clinical_sources": case.clinical_sources,
        "review_status": case.review_status,
        "last_reviewed_at": case.last_reviewed_at,
        "case_content_fingerprint": clinical_case_content_fingerprint(case),
        "source_provenance": {
            "source_count": len(case.clinical_sources or []),
            "organizations": organizations,
            "review_status": review_status,
            "review_label": review_label,
            "requires_caution": review_status != "clinician_reviewed",
            "last_reviewed_at": case.last_reviewed_at,
            "review_valid_until": None,
            "review_stale": False,
            "review_date_invalid": False,
            "review_audit_missing": False,
            "review_audit_incomplete": False,
            "review_content_changed": False,
        },
        "review_audit": _review_audit_snapshot_for_case(case),
    }


def _make_case(review_status: str = "educational_draft") -> ClinicalCase:
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
        key_teaching_points=[
            "Obtain ECG early in acute chest pain",
            "Risk-stratify life-threatening chest pain before reassurance",
            "Check contraindications before antithrombotic treatment",
        ],
        cognitive_traps=[
            "Anchoring",
            "Premature closure after borderline troponin",
        ],
        clinical_red_flags=[
            "Diaphoresis with crushing chest pain",
            "Hypoxia or hemodynamic instability",
        ],
        time_critical_actions=[
            "12-lead ECG within 10 minutes",
            "Serial troponin trend",
            "Activate ACS reperfusion pathway if STEMI criteria are present",
            "Plan antiplatelet and anticoagulation after contraindication checks",
        ],
        contraindication_checks=[
            "Aortic dissection features before anticoagulation",
            "Major bleeding risk before antiplatelet therapy",
            "Recent major surgery before antithrombotic therapy",
            "Hemodynamic instability, heart failure, or pulmonary edema requiring escalation",
        ],
        clinical_sources=[
            {
                "title": "2021 AHA/ACC Chest Pain Guideline",
                "organization": "American Heart Association / American College of Cardiology",
                "url": "https://www.jacc.org/doi/10.1016/j.jacc.2021.07.052",
                "supports": [
                    "ACS diagnosis and risk stratification for acute chest pain",
                    "life-threatening chest pain differential and severity markers",
                    "diaphoresis with crushing chest pain and hypoxia or hemodynamic instability",
                    "12-lead ECG within 10 minutes and serial troponin trend",
                    "ACS reperfusion pathway and antithrombotic planning",
                    "plan antiplatelet and anticoagulation after contraindication checks",
                    "aortic dissection features before anticoagulation",
                    "major bleeding risk and recent surgery before antiplatelet therapy",
                    "hemodynamic instability, heart failure, or pulmonary edema escalation",
                ],
            },
            {
                "title": "Acute Coronary Syndrome",
                "organization": "NCBI Bookshelf / StatPearls",
                "url": "https://www.ncbi.nlm.nih.gov/books/NBK459157/",
                "supports": [
                    "ACS diagnosis and risk stratification for acute chest pain",
                    "diaphoresis with crushing chest pain and hypoxia or hemodynamic instability",
                    "12-lead ECG within 10 minutes and serial troponin trend",
                    "ACS reperfusion pathway and antithrombotic planning",
                    "aortic dissection features before anticoagulation",
                    "major bleeding risk and recent surgery before antiplatelet therapy",
                    "hemodynamic instability, heart failure, or pulmonary edema escalation",
                ],
            },
        ],
        review_status=review_status,
        last_reviewed_at="2026-06-01" if review_status != "ai_generated_unreviewed" else None,
        coach_guidance="Use Socratic questioning.",
    )
    if review_status == "clinician_reviewed":
        case.clinical_reviews = [_review_audit_for_case(case)]
        _refresh_review_fingerprint_for_test(case)
    return case


async def _mark_case_clinician_reviewed_for_test(
    db: AsyncSession,
    case_id: str,
) -> None:
    case = await db.get(ClinicalCase, uuid.UUID(case_id))
    assert case is not None
    case.review_status = "clinician_reviewed"
    case.last_reviewed_at = "2026-06-01"
    db.add(_review_audit_for_case(case))
    await db.commit()


@pytest.mark.asyncio
async def test_create_session_blocks_unreviewed_case_even_with_acknowledgement(
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
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
            "acknowledge_unreviewed_case": True,
        },
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "not clinician reviewed" in response.json()["detail"]
    assert "blocked until clinician review" in response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0


@pytest.mark.asyncio
async def test_create_session_requires_educational_simulation_acknowledgement(
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

    assert response.status_code == 400
    assert "educational simulation" in response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0


@pytest.mark.asyncio
async def test_create_session_allows_clinician_reviewed_case_with_simulation_acknowledgement(
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
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    assert response.json()["case_id"] == str(case.id)
    await db.refresh(case)
    assert case.times_used == 1


@pytest.mark.asyncio
async def test_create_session_blocks_case_without_clinical_sources(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"source-missing-session-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Missing Source Session Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    case.clinical_sources = []
    db.add_all([user, case])
    await db.commit()
    await db.refresh(user)
    await db.refresh(case)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
        },
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "no supporting clinical source" in response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0


@pytest.mark.asyncio
async def test_create_session_blocks_case_failing_quality_gate(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"quality-gate-session-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Quality Gate Session Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    case.clinical_sources[0]["url"] = "https://wellness-blog.com/chest-pain"
    _refresh_review_fingerprint_for_test(case)
    db.add_all([user, case])
    await db.commit()
    await db.refresh(user)
    await db.refresh(case)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
        },
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "Case quality gate blocks learner sessions" in response.json()["detail"]
    assert "reputable clinical source domain" in response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0


@pytest.mark.asyncio
async def test_create_session_blocks_stale_reviewed_case_even_with_acknowledgement(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"stale-reviewed-session-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Stale Reviewed Session Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    case.last_reviewed_at = "2024-01-01"
    db.add_all([user, case])
    await db.commit()
    await db.refresh(user)
    await db.refresh(case)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
        },
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "stale clinician review" in response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0

    acknowledged_response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
            "acknowledge_unreviewed_case": True,
        },
        headers=auth_headers,
    )

    assert acknowledged_response.status_code == 409
    assert "stale clinician review" in acknowledged_response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0


@pytest.mark.asyncio
async def test_create_session_blocks_future_reviewed_case_even_with_acknowledgement(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"future-reviewed-session-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Future Reviewed Session Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    case.last_reviewed_at = "2099-01-01"
    db.add_all([user, case])
    await db.commit()
    await db.refresh(user)
    await db.refresh(case)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
        },
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "invalid clinician review date" in response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0

    acknowledged_response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
            "acknowledge_unreviewed_case": True,
        },
        headers=auth_headers,
    )

    assert acknowledged_response.status_code == 409
    assert "invalid clinician review date" in acknowledged_response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0


@pytest.mark.asyncio
async def test_create_session_blocks_reviewed_case_without_review_audit(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"audit-missing-session-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Missing Audit Session Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    case.clinical_reviews = []
    db.add_all([user, case])
    await db.commit()
    await db.refresh(user)
    await db.refresh(case)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
        },
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "no review audit fingerprint" in response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0


@pytest.mark.asyncio
async def test_create_session_blocks_reviewed_case_with_incomplete_review_audit(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"incomplete-audit-session-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Incomplete Audit Session Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    case.clinical_reviews[0].confirmations = {
        "clinical_accuracy_confirmed": True,
        "source_alignment_confirmed": False,
        "educational_safety_confirmed": True,
    }
    case.clinical_reviews[0].source_snapshot = {
        **case.clinical_reviews[0].source_snapshot,
        "alignment_checklist": {
            **case.clinical_reviews[0].source_snapshot["alignment_checklist"],
            "contraindication_checks_supported": False,
        },
    }
    db.add_all([user, case])
    await db.commit()
    await db.refresh(user)
    await db.refresh(case)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
        },
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "review audit is incomplete" in response.json()["detail"]
    assert "confirms clinical accuracy, source alignment, and educational safety" in response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0


@pytest.mark.asyncio
async def test_stream_response_persists_turn_before_done(
    client: AsyncClient,
    db: AsyncSession,
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
    await _mark_case_clinician_reviewed_for_test(db, case_id)

    session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": case_id,
            "acknowledge_educational_simulation": True,
        },
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
async def test_stream_response_blocks_if_case_quality_fails_after_session_start(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fail_stream_coach_response(**_kwargs):
        if False:
            yield StreamChunk(type="done")
        raise AssertionError("Case quality failures must not reach the provider")

    monkeypatch.setattr(
        sessions_router,
        "stream_coach_response",
        fail_stream_coach_response,
    )
    user = User(
        email=f"stream-quality-gate-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Stream Quality Gate Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    case.clinical_sources = [
        {
            **case.clinical_sources[0],
            "url": "https://wellness-blog.com/chest-pain",
        }
    ]
    _refresh_review_fingerprint_for_test(case)
    session.review_snapshot = _session_review_snapshot_for_case(case)
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "I am considering ACS and would get an ECG."},
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "Case quality gate blocks learner sessions" in response.json()["detail"]
    assert "reputable clinical source domain" in response.json()["detail"]
    messages = await db.execute(
        select(Message).where(Message.session_id == session.id)
    )
    assert list(messages.scalars().all()) == []


@pytest.mark.asyncio
async def test_stream_response_blocks_if_active_session_case_version_changes_after_re_review(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fail_stream_coach_response(**_kwargs):
        if False:
            yield StreamChunk(type="done")
        raise AssertionError("Changed case versions must not reach the provider")

    monkeypatch.setattr(
        sessions_router,
        "stream_coach_response",
        fail_stream_coach_response,
    )
    user = User(
        email=f"stream-version-gate-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Stream Version Gate Tester",
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
    session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
        },
        headers=auth_headers,
    )
    assert session_response.status_code == 201
    session_id = session_response.json()["id"]

    case.key_teaching_points = [
        *case.key_teaching_points,
        "New clinician-reviewed teaching point after session start.",
    ]
    _refresh_review_fingerprint_for_test(case)
    await db.commit()

    response = await client.post(
        f"/api/sessions/{session_id}/stream",
        json={"content": "I am considering ACS and would get an ECG."},
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "earlier version of the case" in response.json()["detail"]
    assert "Start a new session" in response.json()["detail"]


@pytest.mark.asyncio
async def test_stream_response_blocks_legacy_active_session_without_case_snapshot(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fail_stream_coach_response(**_kwargs):
        if False:
            yield StreamChunk(type="done")
        raise AssertionError("Snapshot-less sessions must not reach the provider")

    monkeypatch.setattr(
        sessions_router,
        "stream_coach_response",
        fail_stream_coach_response,
    )
    user = User(
        email=f"stream-missing-snapshot-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Stream Missing Snapshot Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "I am considering ACS and would get an ECG."},
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "no starting case version snapshot" in response.json()["detail"]
    assert "Start a new session" in response.json()["detail"]


@pytest.mark.asyncio
async def test_stream_response_rejects_blank_or_oversized_student_message(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("Invalid student messages must not reach the provider")
        yield

    monkeypatch.setattr(
        sessions_router,
        "stream_coach_response",
        fail_stream_coach_response,
    )
    user = User(
        email=f"stream-input-validation-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Stream Input Validation Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    opening_message = Message(
        session_id=session.id,
        role="coach",
        content="Opening case.",
    )
    db.add(opening_message)
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    blank_response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "   \n\t   "},
        headers=auth_headers,
    )
    oversized_response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "a" * (MAX_STUDENT_MESSAGE_LENGTH + 1)},
        headers=auth_headers,
    )

    assert blank_response.status_code == 422
    assert oversized_response.status_code == 422
    messages = (
        await db.execute(
            select(Message).where(Message.session_id == session.id)
        )
    ).scalars().all()
    assert [message.role for message in messages] == ["coach"]
    assert messages[0].content == "Opening case."


@pytest.mark.asyncio
async def test_real_patient_signal_halts_before_case_snapshot_gate(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("Real-patient signals must not reach the provider")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Real-patient signals must not reach analysis")

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
    user = User(
        email=f"stream-safety-before-snapshot-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Stream Safety Before Snapshot Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "My patient has severe chest pain right now and cannot breathe."},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert "I cannot continue coaching" in response.text
    assert '"type": "done"' in response.text

    await db.refresh(session)
    assert session.status == "safety_locked"
    safety_events = (
        await db.execute(
            select(SafetyEvent).where(SafetyEvent.session_id == session.id)
        )
    ).scalars().all()
    messages = (
        await db.execute(
            select(Message).where(Message.session_id == session.id)
        )
    ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].event_type == "real_patient_or_emergency_signal"
    assert safety_events[0].action_taken == "locked_session_blocked_storage_and_coaching"
    assert "severe chest pain" in safety_events[0].detected_terms
    assert [message.role for message in messages] == ["coach"]
    assert all("cannot breathe" not in message.content for message in messages)


@pytest.mark.asyncio
async def test_patient_identifier_signal_halts_before_case_snapshot_gate(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("Identifier signals must not reach the provider")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Identifier signals must not reach analysis")

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
    user = User(
        email=f"stream-privacy-before-snapshot-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Stream Privacy Before Snapshot Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={
            "content": (
                "Patient name is John Smith, DOB 01/02/1970, "
                "MRN A123456, and phone 555-123-4567."
            ),
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert "patient identifiers" in response.text
    assert '"type": "done"' in response.text

    await db.refresh(session)
    assert session.status == "safety_locked"
    safety_events = (
        await db.execute(
            select(SafetyEvent).where(SafetyEvent.session_id == session.id)
        )
    ).scalars().all()
    messages = (
        await db.execute(
            select(Message).where(Message.session_id == session.id)
        )
    ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].event_type == "possible_patient_identifier"
    assert safety_events[0].action_taken == "locked_session_blocked_storage_and_coaching"
    assert "medical_record_number" in safety_events[0].detected_terms
    assert [message.role for message in messages] == ["coach"]
    assert all("John Smith" not in message.content for message in messages)
    assert all("A123456" not in message.content for message in messages)


@pytest.mark.asyncio
async def test_korean_hospital_identifier_signal_halts_before_storage(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("Korean identifier signals must not reach the provider")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Korean identifier signals must not reach analysis")

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
    user = User(
        email=f"stream-korean-privacy-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Stream Korean Privacy Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={
            "content": (
                "입원번호 ADM-12345, 접수번호 R20260605, "
                "건강보험증번호 H123456789, 카카오톡 ID patient_lee입니다."
            ),
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    text_payload = json.loads(response.text.splitlines()[0].removeprefix("data: "))
    assert "환자 식별자" in text_payload["content"]
    assert '"type": "done"' in response.text

    saved_response = await client.get(
        f"/api/sessions/{session.id}",
        headers=auth_headers,
    )
    saved_session = saved_response.json()
    assert saved_session["status"] == "safety_locked"
    assert "ADM-12345" not in str(saved_session)
    assert "patient_lee" not in str(saved_session)
    assert saved_session["safety_events"][0]["detected_terms"] == [
        "patient identifier signal"
    ]

    safety_events = (
        await db.execute(
            select(SafetyEvent).where(SafetyEvent.session_id == session.id)
        )
    ).scalars().all()
    messages = (
        await db.execute(
            select(Message).where(Message.session_id == session.id)
        )
    ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].event_type == "possible_patient_identifier"
    assert safety_events[0].detected_terms == [
        "medical_record_number",
        "license_or_account_number",
        "messenger_handle",
    ]
    assert [message.role for message in messages] == ["coach"]
    assert all("ADM-12345" not in message.content for message in messages)
    assert all("patient_lee" not in message.content for message in messages)


@pytest.mark.asyncio
async def test_stream_response_hides_internal_provider_errors(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fail_stream_coach_response(**_kwargs) -> AsyncGenerator[StreamChunk, None]:
        raise RuntimeError("anthropic api key sk-test-secret failed")
        yield

    monkeypatch.setattr(
        sessions_router,
        "stream_coach_response",
        fail_stream_coach_response,
    )

    user = User(
        email=f"stream-provider-error-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Stream Provider Error",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case",
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "I would build a broad differential first."},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert sessions_router.STREAM_SAFE_ERROR_MESSAGE in response.text
    assert "sk-test-secret" not in response.text
    assert "anthropic api key" not in response.text


@pytest.mark.asyncio
async def test_stream_response_hides_internal_analysis_errors(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    async def fail_analyze_student_response(**_kwargs) -> ReasoningAnalysis:
        raise RuntimeError("analysis provider leaked token sk-analysis-secret")

    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(
        sessions_router,
        "stream_coach_response",
        fake_stream_coach_response,
    )
    monkeypatch.setattr(
        sessions_router,
        "analyze_student_response",
        fail_analyze_student_response,
    )

    user = User(
        email=f"stream-analysis-error-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Stream Analysis Error",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case",
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "I would build a broad differential first."},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert sessions_router.STREAM_SAFE_ERROR_MESSAGE in response.text
    assert "sk-analysis-secret" not in response.text
    assert "analysis provider leaked" not in response.text


@pytest.mark.asyncio
async def test_stream_response_passes_current_uncovered_safety_targets(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    captured: dict[str, dict[str, list[str]]] = {}

    async def capture_stream_coach_response(**kwargs) -> AsyncGenerator[StreamChunk, None]:
        captured["uncovered_safety_targets"] = kwargs["uncovered_safety_targets"]
        yield StreamChunk(
            type="text_delta",
            content="What remaining safety issue would you actively look for?",
        )
        yield StreamChunk(type="done")

    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(
        sessions_router,
        "stream_coach_response",
        capture_stream_coach_response,
    )
    monkeypatch.setattr(
        sessions_router,
        "analyze_student_response",
        fake_analyze_student_response,
    )

    user = User(
        email=f"safety-focus-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Safety Focus Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case",
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={
            "content": (
                "I am worried about diaphoresis with crushing chest pain and would "
                "obtain a 12-lead ECG within 10 minutes."
            )
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert captured["uncovered_safety_targets"] == {
        "red_flags": ["Hypoxia or hemodynamic instability"],
        "time_critical_actions": [
            "Serial troponin trend",
            "Activate ACS reperfusion pathway if STEMI criteria are present",
            "Plan antiplatelet and anticoagulation after contraindication checks",
        ],
        "contraindication_checks": [
            "Aortic dissection features before anticoagulation",
            "Major bleeding risk before antiplatelet therapy",
            "Recent major surgery before antithrombotic therapy",
            "Hemodynamic instability, heart failure, or pulmonary edema requiring escalation",
        ],
    }


@pytest.mark.asyncio
async def test_stream_response_records_unsafe_coach_output_guardrail(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    async def unsafe_guardrailed_stream(**_kwargs) -> AsyncGenerator[StreamChunk, None]:
        yield StreamChunk(
            type="safety_guardrail",
            content="diagnosis_leak,direct_management_order",
        )
        yield StreamChunk(
            type="text_delta",
            content="What safety checks would you complete before committing to management?",
        )
        yield StreamChunk(type="done")

    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(
        sessions_router,
        "stream_coach_response",
        unsafe_guardrailed_stream,
    )
    monkeypatch.setattr(
        sessions_router,
        "analyze_student_response",
        fake_analyze_student_response,
    )

    user = User(
        email=f"coach-guardrail-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("sessionpass123"),
        full_name="Coach Guardrail Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case",
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "I am considering dangerous diagnoses first."},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert "What safety checks would you complete" in response.text
    assert "diagnosis_leak" not in response.text
    safety_events = (
        await db.execute(
            select(SafetyEvent).where(SafetyEvent.session_id == session.id)
        )
    ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].event_type == "unsafe_coach_output_guardrail"
    assert safety_events[0].severity == "medium"
    assert safety_events[0].status == "open"
    assert safety_events[0].action_taken == "unsafe_model_output_replaced_before_delivery"
    assert safety_events[0].detected_terms == [
        "diagnosis_leak",
        "direct_management_order",
    ]

    complete_response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert complete_response.status_code == 400
    assert complete_response.json()["detail"]["code"] == "open_safety_events_unresolved"
    assert complete_response.json()["detail"]["open_safety_events"][0]["event_type"] == (
        "unsafe_coach_output_guardrail"
    )


@pytest.mark.asyncio
async def test_complete_session_requires_analyzed_learner_response(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"complete-guard-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("completepass123"),
        full_name="Complete Guard Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case",
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "At least one analyzed learner response is required before completion"
    )
    await db.refresh(session)
    assert session.status == "active"
    assert session.final_reasoning_score is None


@pytest.mark.asyncio
async def test_safety_locked_session_cannot_be_completed(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"safety-complete-lock-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Complete Lock",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="safety_locked",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add_all([
        Message(
            session_id=session.id,
            role="coach",
            content="Opening case",
        ),
        Message(
            session_id=session.id,
            role="student",
            content="I considered ACS and got an ECG.",
            reasoning_score=82,
        ),
    ])
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Session is not active"
    await db.refresh(session)
    assert session.status == "safety_locked"
    assert session.final_reasoning_score is None
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_blocks_open_safety_events_before_completion(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"open-safety-complete-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Open Safety Complete Guard",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(SafetyEvent(
        session_id=session.id,
        user_id=user.id,
        event_type="management_before_safety_checks",
        severity="medium",
        action_taken="coach_redirected_to_safety_checks",
        detected_terms=["intubation"],
        message_turn=1,
        note="Learner committed to airway management before safety checks.",
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "open_safety_events_unresolved",
        "message": (
            "Before finishing, resolve or review open safety events from this "
            "session. Continue the simulation only after the safety issue has "
            "been addressed."
        ),
        "open_safety_events": [
            {
                "event_type": "management_before_safety_checks",
                "severity": "medium",
                "message_turn": 1,
                "detected_terms": ["intubation"],
            }
        ],
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.final_reasoning_score is None
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_reviewer_can_read_safety_locked_session_with_safety_event(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"safety-context-learner-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Context Learner",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    reviewer = User(
        email=f"safety-context-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Context Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([learner, reviewer, case])
    await db.flush()
    session = CoachingSession(
        user_id=learner.id,
        case_id=case.id,
        status="safety_locked",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add_all([
        Message(
            session_id=session.id,
            role="coach",
            content="Opening case",
        ),
        Message(
            session_id=session.id,
            role="coach",
            content="I cannot continue coaching on a real patient or emergency scenario.",
        ),
        SafetyEvent(
            session_id=session.id,
            user_id=learner.id,
            event_type="real_patient_or_emergency_signal",
            severity="high",
            action_taken="locked_session_blocked_storage_and_coaching",
            detected_terms=["right now"],
            message_turn=1,
            note="Session was locked for reviewer audit.",
        ),
    ])
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(reviewer.id)})}",
    }

    response = await client.get(f"/api/sessions/{session.id}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == str(session.id)
    assert payload["status"] == "safety_locked"
    assert [message["role"] for message in payload["messages"]] == ["coach", "coach"]
    assert "I cannot continue coaching" in payload["messages"][1]["content"]
    assert payload["safety_events"] == [
        {
            "event_type": "real_patient_or_emergency_signal",
            "severity": "high",
            "status": "open",
            "message_turn": 1,
            "detected_terms": ["real patient or emergency signal"],
            "resolution_note": None,
            "resolved_at": None,
        }
    ]


@pytest.mark.asyncio
async def test_reviewer_can_read_active_session_with_safety_event_context(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"active-context-learner-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Active Context Learner",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    reviewer = User(
        email=f"active-context-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Active Context Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([learner, reviewer, case])
    await db.flush()
    session = CoachingSession(
        user_id=learner.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add_all([
        Message(
            session_id=session.id,
            role="coach",
            content="Opening case",
        ),
        Message(
            session_id=session.id,
            role="student",
            content="I would give heparin now before checking contraindications.",
            reasoning_score=65,
        ),
        SafetyEvent(
            session_id=session.id,
            user_id=learner.id,
            event_type="management_before_safety_checks",
            severity="medium",
            action_taken="coach_redirected_to_safety_checks",
            detected_terms=["heparin"],
            message_turn=1,
            note="Active learner session needs reviewer context.",
        ),
    ])
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(reviewer.id)})}",
    }

    response = await client.get(f"/api/sessions/{session.id}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == str(session.id)
    assert payload["status"] == "active"
    assert [message["role"] for message in payload["messages"]] == ["coach", "student"]
    assert "heparin now" in payload["messages"][1]["content"]
    assert payload["safety_events"] == [
        {
            "event_type": "management_before_safety_checks",
            "severity": "medium",
            "status": "open",
            "message_turn": 1,
            "detected_terms": ["heparin"],
            "resolution_note": None,
            "resolved_at": None,
        }
    ]


@pytest.mark.asyncio
async def test_reviewer_can_read_completed_safety_event_session_review(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"completed-safety-review-learner-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Completed Safety Review Learner",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    reviewer = User(
        email=f"completed-safety-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Completed Safety Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([learner, reviewer, case])
    await db.flush()
    session = CoachingSession(
        user_id=learner.id,
        case_id=case.id,
        status="completed",
        final_reasoning_score=82,
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add_all([
        Message(
            session_id=session.id,
            role="student",
            content=COMPLETE_ACS_SAFETY_REASONING,
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
        ),
        SafetyEvent(
            session_id=session.id,
            user_id=learner.id,
            event_type="management_before_safety_checks",
            severity="medium",
            status="resolved",
            action_taken="coach_redirected_to_safety_checks",
            detected_terms=["heparin"],
            message_turn=1,
            note="Reviewer needs completed learning review context.",
            resolution_note="Reviewed safety redirect and completed audit.",
            resolved_at=datetime.now(timezone.utc),
            resolved_by_user_id=reviewer.id,
        ),
    ])
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(reviewer.id)})}",
    }

    response = await client.get(
        f"/api/sessions/{session.id}/review",
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == str(session.id)
    assert payload["diagnosis"] == "Acute coronary syndrome"
    assert payload["clinical_safety_completion"]["complete"] is True
    assert len(payload["safety_events"]) == 1
    safety_event = payload["safety_events"][0]
    assert safety_event["event_type"] == "management_before_safety_checks"
    assert safety_event["severity"] == "medium"
    assert safety_event["status"] == "resolved"
    assert safety_event["message_turn"] == 1
    assert safety_event["detected_terms"] == ["heparin"]
    assert safety_event["resolution_note"] == "Reviewed safety redirect and completed audit."
    assert safety_event["resolved_at"] is not None
    assert payload["review_audit"]["confirmations"]["clinical_accuracy_confirmed"] is True


@pytest.mark.asyncio
async def test_reviewer_cannot_read_completed_session_review_without_safety_event(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"completed-private-learner-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Completed Private Learner",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    reviewer = User(
        email=f"completed-private-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Completed Private Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([learner, reviewer, case])
    await db.flush()
    session = CoachingSession(
        user_id=learner.id,
        case_id=case.id,
        status="completed",
        final_reasoning_score=82,
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(reviewer.id)})}",
    }

    response = await client.get(
        f"/api/sessions/{session.id}/review",
        headers=auth_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Session not found"


@pytest.mark.asyncio
async def test_reviewer_cannot_read_active_session_without_safety_event(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"active-private-learner-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Active Private Learner",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    reviewer = User(
        email=f"active-private-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Active Private Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([learner, reviewer, case])
    await db.flush()
    session = CoachingSession(
        user_id=learner.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case",
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(reviewer.id)})}",
    }

    response = await client.get(f"/api/sessions/{session.id}", headers=auth_headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "Session not found"


@pytest.mark.asyncio
async def test_complete_session_requires_full_clinical_safety_coverage(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"safety-coverage-guard-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Coverage Guard",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content="I am worried about diaphoresis with crushing chest pain and want an ECG.",
        reasoning_score=82,
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "clinical_safety_coverage_incomplete",
        "message": (
            "Before finishing, address red flags, time-critical actions, and "
            "contraindication checks in your reasoning."
        ),
        "covered_count": 1,
        "total_count": 10,
        "uncovered_categories": [
            {"category": "red_flags", "label": "Red flags", "missing_count": 1},
            {
                "category": "time_critical_actions",
                "label": "Time-critical actions",
                "missing_count": 4,
            },
            {
                "category": "contraindication_checks",
                "label": "Contraindication checks",
                "missing_count": 4,
            },
        ],
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.final_reasoning_score is None
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_succeeds_after_all_clinical_safety_targets_covered(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"safety-coverage-complete-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Coverage Complete",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "After that safety pass, I would refine my differential and explain what "
            "new ECG or troponin findings would change my management plan."
        ),
        reasoning_score=86,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["final_reasoning_score"] == 84
    assert payload["completed_at"] is not None


@pytest.mark.asyncio
async def test_session_review_uses_completion_snapshot_after_case_changes(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"review-snapshot-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Review Snapshot Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "After that safety pass, I would refine my differential and explain what "
            "new ECG or troponin findings would change my management plan."
        ),
        reasoning_score=86,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(SafetyEvent(
        session_id=session.id,
        user_id=user.id,
        event_type="management_before_safety_checks",
        severity="medium",
        action_taken="coach_redirected_to_safety_checks",
        detected_terms=["heparin"],
        message_turn=1,
        note="Learner committed to management before safety checks.",
        status="resolved",
        resolution_note=(
            "Reviewed safety redirect and learner later addressed anticoagulation checks."
        ),
        resolved_at=datetime.now(timezone.utc),
        resolved_by_user_id=user.id,
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    complete_response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )
    assert complete_response.status_code == 200
    await db.refresh(session)
    assert session.review_snapshot["diagnosis"] == "Acute coronary syndrome"

    case.diagnosis = "Changed diagnosis after completion"
    case.key_teaching_points = ["Changed teaching point"]
    case.clinical_sources = [
        {
            "title": "Changed Source",
            "organization": "Changed Organization",
            "url": "https://www.nejm.org/changed",
            "supports": ["changed support"],
        }
    ]
    case.clinical_red_flags = ["Changed red flag"]
    await db.commit()

    review_response = await client.get(
        f"/api/sessions/{session.id}/review",
        headers=auth_headers,
    )

    assert review_response.status_code == 200
    payload = review_response.json()
    assert payload["diagnosis"] == "Acute coronary syndrome"
    assert payload["key_teaching_points"] == [
        "Obtain ECG early in acute chest pain",
        "Risk-stratify life-threatening chest pain before reassurance",
        "Check contraindications before antithrombotic treatment",
    ]
    assert payload["clinical_sources"][0]["title"] == "2021 AHA/ACC Chest Pain Guideline"
    assert payload["review_audit"] == {
        "confirmations": {
            "clinical_accuracy_confirmed": True,
            "source_alignment_confirmed": True,
            "educational_safety_confirmed": True,
        },
        "source_alignment_checks": {
            "teaching_points_supported": True,
            "red_flags_supported": True,
            "time_critical_actions_supported": True,
            "contraindication_checks_supported": True,
        },
        "review_notes": "Test clinician review with source and safety alignment.",
    }
    assert payload["clinical_safety_coverage"]["red_flags"][0]["item"] == (
        "Diaphoresis with crushing chest pain"
    )
    assert len(payload["safety_events"]) == 1
    safety_event = payload["safety_events"][0]
    assert safety_event["event_type"] == "management_before_safety_checks"
    assert safety_event["severity"] == "medium"
    assert safety_event["status"] == "resolved"
    assert safety_event["message_turn"] == 1
    assert safety_event["detected_terms"] == ["heparin"]
    assert safety_event["resolution_note"] == (
        "Reviewed safety redirect and learner later addressed anticoagulation checks."
    )
    assert safety_event["resolved_at"] is not None
    assert payload["source_provenance"]["review_content_changed"] is True


@pytest.mark.asyncio
async def test_complete_session_blocks_if_active_session_case_version_changes_after_re_review(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"complete-version-gate-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Complete Version Gate Tester",
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
    session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
        },
        headers=auth_headers,
    )
    assert session_response.status_code == 201
    session_id = uuid.UUID(session_response.json()["id"])
    db.add(Message(
        session_id=session_id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session_id,
        role="student",
        content=(
            "After that safety pass, I would refine my differential and explain what "
            "new ECG or troponin findings would change my management plan."
        ),
        reasoning_score=86,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    case.key_teaching_points = [
        *case.key_teaching_points,
        "New clinician-reviewed teaching point after session start.",
    ]
    _refresh_review_fingerprint_for_test(case)
    await db.commit()

    response = await client.post(
        f"/api/sessions/{session_id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "earlier version of the case" in response.json()["detail"]
    session = await db.get(CoachingSession, session_id)
    assert session is not None
    assert session.status == "active"
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_blocks_legacy_active_session_without_case_snapshot(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"complete-missing-snapshot-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Complete Missing Snapshot Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
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
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "After that safety pass, I would refine my differential and explain what "
            "new ECG or troponin findings would change my management plan."
        ),
        reasoning_score=86,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "no starting case version snapshot" in response.json()["detail"]
    await db.refresh(session)
    assert session.status == "active"
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_blocks_if_case_quality_fails_after_session_start(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"complete-quality-gate-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Complete Quality Gate",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "After that safety pass, I would refine my differential and explain what "
            "new ECG or troponin findings would change my management plan."
        ),
        reasoning_score=86,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    case.clinical_sources = [
        {
            **case.clinical_sources[0],
            "url": "https://wellness-blog.com/chest-pain",
        }
    ]
    _refresh_review_fingerprint_for_test(case)
    session.review_snapshot = _session_review_snapshot_for_case(case)
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 409
    assert "Case quality gate blocks learner sessions" in response.json()["detail"]
    assert "reputable clinical source domain" in response.json()["detail"]
    await db.refresh(session)
    assert session.status == "active"
    assert session.final_reasoning_score is None
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_blocks_management_before_prior_safety_checks(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"management-sequence-guard-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Management Sequence Guard",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content="I would start heparin now for this chest pain presentation.",
        reasoning_score=82,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=86,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "management_before_safety_checks_incomplete",
        "message": (
            "Before finishing, revisit any management plan that was stated before "
            "red flags, time-critical actions, or safety checks and explain those "
            "checks first."
        ),
        "unsafe_management_turns": [
            {
                "turn": 1,
                "detected_terms": ["heparin"],
                "missing_red_flags": [
                    "Diaphoresis with crushing chest pain",
                    "Hypoxia or hemodynamic instability",
                ],
                "missing_time_critical_actions": [
                    "12-lead ECG within 10 minutes",
                    "Serial troponin trend",
                    "Activate ACS reperfusion pathway if STEMI criteria are present",
                    "Plan antiplatelet and anticoagulation after contraindication checks",
                ],
                "missing_contraindication_checks": [
                    "Aortic dissection features before anticoagulation",
                    "Major bleeding risk before antiplatelet therapy",
                    "Recent major surgery before antithrombotic therapy",
                    "Hemodynamic instability, heart failure, or pulmonary edema requiring escalation",
                ],
            }
        ],
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_reports_premature_discharge_missing_safety_targets(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"discharge-sequence-guard-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Discharge Sequence Guard",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content="I would discharge him home now with outpatient follow-up.",
        reasoning_score=82,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=86,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "management_before_safety_checks_incomplete",
        "message": (
            "Before finishing, revisit any management plan that was stated before "
            "red flags, time-critical actions, or safety checks and explain those "
            "checks first."
        ),
        "unsafe_management_turns": [
            {
                "turn": 1,
                "detected_terms": ["discharge", "outpatient follow-up"],
                "missing_red_flags": [
                    "Diaphoresis with crushing chest pain",
                    "Hypoxia or hemodynamic instability",
                ],
                "missing_time_critical_actions": [
                    "12-lead ECG within 10 minutes",
                    "Serial troponin trend",
                    "Activate ACS reperfusion pathway if STEMI criteria are present",
                    "Plan antiplatelet and anticoagulation after contraindication checks",
                ],
                "missing_contraindication_checks": [
                    "Aortic dissection features before anticoagulation",
                    "Major bleeding risk before antiplatelet therapy",
                    "Recent major surgery before antithrombotic therapy",
                    "Hemodynamic instability, heart failure, or pulmonary edema requiring escalation",
                ],
            }
        ],
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_ignores_unanalyzed_turns_for_safety_coverage(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"unanalyzed-safety-coverage-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Unanalyzed Safety Coverage",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=None,
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content="I would keep a broad differential and explain my uncertainty.",
        reasoning_score=82,
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content="I would revisit the differential as new information arrives.",
        reasoning_score=86,
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "clinical_safety_coverage_incomplete",
        "message": (
            "Before finishing, address red flags, time-critical actions, and "
            "contraindication checks in your reasoning."
        ),
        "covered_count": 0,
        "total_count": 10,
        "uncovered_categories": [
            {"category": "red_flags", "label": "Red flags", "missing_count": 2},
            {
                "category": "time_critical_actions",
                "label": "Time-critical actions",
                "missing_count": 4,
            },
            {
                "category": "contraindication_checks",
                "label": "Contraindication checks",
                "missing_count": 4,
            },
        ],
    }


@pytest.mark.asyncio
async def test_complete_session_accepts_korean_clinical_safety_coverage(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"korean-safety-coverage-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Korean Safety Coverage",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=KOREAN_COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "그 다음 심전도와 트로포닌 추이를 바탕으로 위험도와 감별진단을 "
            "다시 정리하겠습니다."
        ),
        reasoning_score=86,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["final_reasoning_score"] == 84
    assert payload["completed_at"] is not None


@pytest.mark.asyncio
async def test_complete_session_blocks_low_bounded_reasoning_score(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"bounded-final-score-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Bounded Final Score",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=135,
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "I would revisit the differential after the ECG and troponin trend and "
            "state what evidence would lower my concern."
        ),
        reasoning_score=-15,
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "clinical_reasoning_quality_incomplete",
        "message": (
            "Before finishing, strengthen your clinical reasoning quality with "
            "clearer differential diagnosis, evidence integration, prioritization, "
            "and mechanism explanation."
        ),
        "current_score": 50.0,
        "minimum_score": 60.0,
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.final_reasoning_score is None
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_blocks_zero_dimension_scores_even_with_high_total_score(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"zero-dimension-score-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("dimensionpass123"),
        full_name="Zero Dimension Score",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    zero_breakdown = {
        "score_breakdown": {
            "systematic_approach": 0,
            "evidence_integration": 0,
            "prioritization": 0,
            "mechanism_understanding": 0,
        },
    }
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=88,
        reasoning_analysis=zero_breakdown,
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "I would revisit the differential after the ECG and troponin trend and "
            "state what evidence would lower my concern."
        ),
        reasoning_score=90,
        reasoning_analysis=zero_breakdown,
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "clinical_reasoning_dimension_incomplete",
        "message": (
            "Before finishing, strengthen each core clinical reasoning dimension, "
            "especially prioritization, evidence integration, systematic approach, "
            "and mechanism understanding."
        ),
        "deficient_dimensions": [
            {
                "dimension": "systematic_approach",
                "label": "Systematic approach",
                "current_score": 0.0,
                "minimum_score": 12.0,
            },
            {
                "dimension": "evidence_integration",
                "label": "Evidence integration",
                "current_score": 0.0,
                "minimum_score": 12.0,
            },
            {
                "dimension": "prioritization",
                "label": "Clinical prioritization",
                "current_score": 0.0,
                "minimum_score": 12.0,
            },
            {
                "dimension": "mechanism_understanding",
                "label": "Mechanism understanding",
                "current_score": 0.0,
                "minimum_score": 12.0,
            },
        ],
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.final_reasoning_score is None
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_blocks_active_severe_cognitive_bias(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"active-severe-bias-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("biaspass123"),
        full_name="Active Severe Bias",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "I am still closing on ACS and would ignore alternatives despite the "
            "coach asking what evidence could disconfirm it."
        ),
        reasoning_score=88,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(BiasEvent(
        session_id=session.id,
        user_id=user.id,
        bias_type="premature_closure",
        severity="severe",
        evidence="Student explicitly ignored alternatives.",
        confidence=0.91,
        message_turn=2,
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "active_severe_cognitive_bias",
        "message": (
            "Before finishing, revisit the severe cognitive bias detected in your "
            "latest reasoning turn and explain how you would test or correct it."
        ),
        "biases": [
            {
                "bias_type": "premature_closure",
                "label": "Premature closure",
                "severity": "severe",
                "confidence": 0.91,
                "message_turn": 2,
            }
        ],
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.final_reasoning_score is None
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_requires_core_reasoning_dimensions_to_be_available(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"missing-dimensions-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("dimensionpass123"),
        full_name="Missing Dimensions",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=84,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "I would revisit the differential after the ECG and troponin trend and "
            "state what evidence would lower my concern."
        ),
        reasoning_score=86,
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "clinical_reasoning_dimensions_unavailable",
        "message": (
            "Before finishing, complete analyzed learner turns with all core "
            "clinical reasoning dimension scores."
        ),
        "missing_turns": [
            {
                "turn": 2,
                "missing_dimensions": [
                    {
                        "dimension": "systematic_approach",
                        "label": "Systematic approach",
                    },
                    {
                        "dimension": "evidence_integration",
                        "label": "Evidence integration",
                    },
                    {
                        "dimension": "prioritization",
                        "label": "Clinical prioritization",
                    },
                    {
                        "dimension": "mechanism_understanding",
                        "label": "Mechanism understanding",
                    },
                ],
            }
        ],
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.final_reasoning_score is None
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_blocks_low_core_reasoning_dimension(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"dimension-guard-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("dimensionpass123"),
        full_name="Dimension Guard",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=84,
        reasoning_analysis={
            "score_breakdown": {
                "systematic_approach": 24,
                "evidence_integration": 24,
                "prioritization": 6,
                "mechanism_understanding": 24,
            },
        },
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "I would revisit the differential after the ECG and troponin trend and "
            "state what evidence would lower my concern."
        ),
        reasoning_score=86,
        reasoning_analysis={
            "score_breakdown": {
                "systematic_approach": 24,
                "evidence_integration": 24,
                "prioritization": 8,
                "mechanism_understanding": 24,
            },
        },
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "clinical_reasoning_dimension_incomplete",
        "message": (
            "Before finishing, strengthen each core clinical reasoning dimension, "
            "especially prioritization, evidence integration, systematic approach, "
            "and mechanism understanding."
        ),
        "deficient_dimensions": [
            {
                "dimension": "prioritization",
                "label": "Clinical prioritization",
                "current_score": 7.0,
                "minimum_score": 12.0,
            }
        ],
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.final_reasoning_score is None
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_complete_session_allows_earlier_severe_bias_after_later_correction(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"corrected-severe-bias-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("biaspass123"),
        full_name="Corrected Severe Bias",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "I corrected my anchoring by stating what ECG, troponin, dissection, "
            "and bleeding findings would change my differential and management."
        ),
        reasoning_score=88,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(BiasEvent(
        session_id=session.id,
        user_id=user.id,
        bias_type="anchoring",
        severity="severe",
        evidence="Early turn fixated on ACS.",
        confidence=0.9,
        message_turn=1,
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["final_reasoning_score"] == 85
    assert payload["bias_summary"] == {"anchoring": 1}


@pytest.mark.asyncio
async def test_complete_session_ignores_coach_reasoning_scores_for_completion_gate(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"coach-score-guard-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Coach Score Guard",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
    ))
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="What evidence would make you reconsider?",
        reasoning_score=100,
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "minimum_reasoning_turns_incomplete",
        "message": (
            "Before finishing, complete at least two analyzed learner reasoning turns."
        ),
        "analyzed_turn_count": 1,
        "minimum_turn_count": 2,
        "remaining_turn_count": 1,
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.final_reasoning_score is None


@pytest.mark.asyncio
async def test_complete_session_ignores_coach_reasoning_scores_in_final_score(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"coach-final-score-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Coach Final Score",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "I would revisit the differential after the ECG and troponin trend and "
            "state what evidence would lower my concern."
        ),
        reasoning_score=86,
        reasoning_analysis=_passing_reasoning_analysis(),
    ))
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Coach messages should not affect learner scoring.",
        reasoning_score=0,
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["final_reasoning_score"] == 84


@pytest.mark.asyncio
async def test_complete_session_requires_multiple_analyzed_reasoning_turns(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"reasoning-turn-guard-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Reasoning Turn Guard",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "minimum_reasoning_turns_incomplete",
        "message": (
            "Before finishing, complete at least two analyzed learner reasoning turns."
        ),
        "analyzed_turn_count": 1,
        "minimum_turn_count": 2,
        "remaining_turn_count": 1,
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_negated_safety_mentions_do_not_satisfy_completion_coverage(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"safety-coverage-negated-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Coverage Negated",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "I need to address diaphoresis with crushing chest pain plus hypoxia "
            "or hemodynamic instability. I would obtain a 12-lead ECG within "
            "10 minutes and trend serial troponin. I did not check for aortic "
            "dissection features before anticoagulation. I assessed major bleeding "
            "risk before antiplatelet therapy."
        ),
        reasoning_score=82,
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "clinical_safety_coverage_incomplete",
        "message": (
            "Before finishing, address red flags, time-critical actions, and "
            "contraindication checks in your reasoning."
        ),
        "covered_count": 7,
        "total_count": 10,
        "uncovered_categories": [
            {
                "category": "time_critical_actions",
                "label": "Time-critical actions",
                "missing_count": 2,
            },
            {
                "category": "contraindication_checks",
                "label": "Contraindication checks",
                "missing_count": 1,
            },
        ],
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_korean_negated_safety_mentions_do_not_satisfy_completion_coverage(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"korean-safety-coverage-negated-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Korean Safety Coverage Negated",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "식은땀을 동반한 쥐어짜는 흉통과 저산소증 또는 혈역학적 "
            "불안정을 위험 신호로 보고, 10분 이내 12유도 심전도와 "
            "반복 트로포닌 추적을 하겠습니다. 항응고 전 대동맥 박리는 "
            "확인하지 않았고, 항혈소판 치료 전 주요 출혈 위험은 평가했습니다."
        ),
        reasoning_score=82,
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content="심전도와 트로포닌 추이를 바탕으로 감별진단을 정리하겠습니다.",
        reasoning_score=86,
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "clinical_safety_coverage_incomplete",
        "message": (
            "Before finishing, address red flags, time-critical actions, and "
            "contraindication checks in your reasoning."
        ),
        "covered_count": 5,
        "total_count": 10,
        "uncovered_categories": [
            {
                "category": "time_critical_actions",
                "label": "Time-critical actions",
                "missing_count": 2,
            },
            {
                "category": "contraindication_checks",
                "label": "Contraindication checks",
                "missing_count": 3,
            },
        ],
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_passive_contraindication_mentions_do_not_satisfy_completion_coverage(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"safety-coverage-passive-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Coverage Passive",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "I need to address diaphoresis with crushing chest pain plus hypoxia "
            "or hemodynamic instability. I would obtain a 12-lead ECG within "
            "10 minutes and trend serial troponin. Aortic dissection features "
            "are unlikely before anticoagulation, and major bleeding risk is low "
            "before antiplatelet therapy."
        ),
        reasoning_score=82,
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "I would keep refining the differential after the initial safety pass."
        ),
        reasoning_score=86,
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        f"/api/sessions/{session.id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "clinical_safety_coverage_incomplete",
        "message": (
            "Before finishing, address red flags, time-critical actions, and "
            "contraindication checks in your reasoning."
        ),
        "covered_count": 6,
        "total_count": 10,
        "uncovered_categories": [
            {
                "category": "time_critical_actions",
                "label": "Time-critical actions",
                "missing_count": 1,
            },
            {
                "category": "contraindication_checks",
                "label": "Contraindication checks",
                "missing_count": 3,
            },
        ],
    }
    await db.refresh(session)
    assert session.status == "active"
    assert session.completed_at is None


@pytest.mark.asyncio
async def test_real_patient_signal_halts_coaching_and_records_safety_event(
    client: AsyncClient,
    db: AsyncSession,
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
    await _mark_case_clinician_reviewed_for_test(db, case_response.json()["id"])
    session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": case_response.json()["id"],
            "acknowledge_educational_simulation": True,
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
    assert saved_session["status"] == "safety_locked"
    assert saved_session["completed_at"] is None
    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "coach",
    ]
    assert "I cannot continue coaching" in saved_session["messages"][1]["content"]
    assert "cannot breathe" not in str(saved_session)
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
        messages = (
            await db.execute(
                select(Message).where(Message.session_id == uuid.UUID(session_id))
            )
        ).scalars().all()
    assert len(safety_events) == 1
    assert (
        safety_events[0].action_taken
        == "locked_session_blocked_storage_and_coaching"
    )
    assert "severe chest pain" in safety_events[0].detected_terms
    assert "student message storage" in safety_events[0].note
    assert [message.role for message in messages] == ["coach", "coach"]
    assert all("cannot breathe" not in message.content for message in messages)

    repeat_response = await client.post(
        f"/api/sessions/{session_id}/stream",
        json={"content": "Can we keep going with the simulation?"},
        headers=auth_headers,
    )
    assert repeat_response.status_code == 400
    assert repeat_response.json()["detail"] == "Session is not active"


@pytest.mark.asyncio
async def test_korean_real_patient_signal_uses_korean_safety_response(
    client: AsyncClient,
    db: AsyncSession,
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

    email = f"korean-safety-{uuid.uuid4()}@test.com"
    register_response = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "safetypass123",
            "full_name": "Korean Safety Tester",
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
    await _mark_case_clinician_reviewed_for_test(db, case_response.json()["id"])
    session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": case_response.json()["id"],
            "acknowledge_educational_simulation": True,
        },
        headers=auth_headers,
    )
    session_id = session_response.json()["id"]

    stream_response = await client.post(
        f"/api/sessions/{session_id}/stream",
        json={"content": "제 환자가 지금 숨을 못 쉬고 있습니다."},
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert "119" in stream_response.text
    assert '"type": "done"' in stream_response.text

    saved_response = await client.get(
        f"/api/sessions/{session_id}",
        headers=auth_headers,
    )
    saved_session = saved_response.json()
    assert saved_session["status"] == "safety_locked"
    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "coach",
    ]
    assert saved_session["messages"][1]["content"] == KOREAN_REAL_PATIENT_SAFETY_RESPONSE
    assert "제 환자가" not in str(saved_session)

    async with TestSessionLocal() as db:
        safety_events = (
            await db.execute(
                select(SafetyEvent).where(
                    SafetyEvent.session_id == uuid.UUID(session_id)
                )
            )
        ).scalars().all()
    assert len(safety_events) == 1
    assert "제 환자" in safety_events[0].detected_terms
    assert "숨을 못 쉬" in safety_events[0].detected_terms


@pytest.mark.asyncio
async def test_family_emergency_signal_halts_before_model_call(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("LLM coaching should not run for family emergency signals")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Reasoning analysis should not run for family emergency signals")

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

    user = User(
        email=f"family-emergency-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Family Emergency Tester",
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
    session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
        },
        headers=auth_headers,
    )
    assert session_response.status_code == 201
    session_id = session_response.json()["id"]

    stream_response = await client.post(
        f"/api/sessions/{session_id}/stream",
        json={"content": "My daughter cannot breathe. Should I call an ambulance?"},
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert "I cannot continue coaching" in stream_response.text
    saved_response = await client.get(
        f"/api/sessions/{session_id}",
        headers=auth_headers,
    )
    saved_session = saved_response.json()
    assert saved_session["status"] == "safety_locked"
    assert "My daughter" not in str(saved_session)

    async with TestSessionLocal() as db:
        safety_events = (
            await db.execute(
                select(SafetyEvent).where(
                    SafetyEvent.session_id == uuid.UUID(session_id)
                )
            )
        ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].event_type == "real_patient_or_emergency_signal"
    assert "my daughter" in safety_events[0].detected_terms
    assert "call an ambulance" in safety_events[0].detected_terms


@pytest.mark.asyncio
async def test_simulated_urgent_symptoms_do_not_trigger_real_patient_lock(
    client: AsyncClient,
    db: AsyncSession,
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

    user = User(
        email=f"simulated-urgent-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Simulated Urgent Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case presentation.",
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    stream_response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={
            "content": (
                "In this simulated case, the patient has severe chest pain right now "
                "and I want to prioritize dangerous causes."
            ),
        },
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert "I cannot continue coaching" not in stream_response.text
    assert "What finding would most change your differential?" in stream_response.text

    saved_response = await client.get(
        f"/api/sessions/{session.id}",
        headers=auth_headers,
    )
    assert saved_response.status_code == 200
    saved_session = saved_response.json()
    assert saved_session["status"] == "active"
    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "student",
        "coach",
    ]
    assert saved_session["messages"][1]["reasoning_score"] == 82
    assert saved_session["reasoning_map"]["nodes"]

    async with TestSessionLocal() as safety_db:
        safety_events = (
            await safety_db.execute(
                select(SafetyEvent).where(SafetyEvent.session_id == session.id)
            )
        ).scalars().all()
    assert safety_events == []


@pytest.mark.asyncio
async def test_management_before_safety_checks_redirects_and_records_safety_event(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("LLM coaching should not run before safety redirect")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Reasoning analysis should not run before safety redirect")

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

    user = User(
        email=f"management-safety-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Management Safety Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case presentation.",
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    stream_response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "In this simulation I would start heparin now."},
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert "Pause the management plan" in stream_response.text
    assert "contraindications or safety checks" in stream_response.text
    assert '"type": "done"' in stream_response.text

    saved_response = await client.get(
        f"/api/sessions/{session.id}",
        headers=auth_headers,
    )
    assert saved_response.status_code == 200
    saved_session = saved_response.json()
    assert saved_session["status"] == "active"
    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "student",
        "coach",
    ]
    assert saved_session["messages"][1]["reasoning_score"] is None
    assert "Pause the management plan" in saved_session["messages"][2]["content"]
    assert saved_session["reasoning_map"]["nodes"] == []

    async with TestSessionLocal() as safety_db:
        safety_events = (
            await safety_db.execute(
                select(SafetyEvent).where(SafetyEvent.session_id == session.id)
            )
        ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].event_type == "management_before_safety_checks"
    assert safety_events[0].severity == "medium"
    assert safety_events[0].action_taken == "coach_redirected_to_safety_checks"
    assert safety_events[0].detected_terms == ["heparin"]
    assert "Aortic dissection features before anticoagulation" in safety_events[0].note
    assert safety_events[0].status == "open"


@pytest.mark.asyncio
async def test_partial_same_turn_safety_check_still_redirects_management_plan(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("LLM coaching should not run before complete safety checks")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Reasoning analysis should not run before safety redirect")

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

    user = User(
        email=f"partial-management-safety-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Partial Management Safety Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case presentation.",
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    stream_response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={
            "content": (
                "In this simulation I would start heparin after checking for "
                "aortic dissection."
            )
        },
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert "Pause the management plan" in stream_response.text
    assert '"type": "done"' in stream_response.text

    saved_response = await client.get(
        f"/api/sessions/{session.id}",
        headers=auth_headers,
    )
    assert saved_response.status_code == 200
    saved_session = saved_response.json()
    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "student",
        "coach",
    ]
    assert saved_session["messages"][1]["reasoning_score"] is None
    assert saved_session["reasoning_map"]["nodes"] == []

    async with TestSessionLocal() as safety_db:
        safety_events = (
            await safety_db.execute(
                select(SafetyEvent).where(SafetyEvent.session_id == session.id)
            )
        ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].event_type == "management_before_safety_checks"
    assert safety_events[0].detected_terms == ["heparin"]
    assert "Major bleeding risk before antiplatelet therapy" in safety_events[0].note
    assert safety_events[0].status == "open"


@pytest.mark.asyncio
async def test_intubation_before_safety_checks_redirects_and_records_safety_event(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("LLM coaching should not run before airway safety redirect")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Reasoning analysis should not run before airway safety redirect")

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

    user = User(
        email=f"intubation-safety-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Intubation Safety Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case presentation.",
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    stream_response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "In this simulation I would intubate now."},
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert "Pause the management plan" in stream_response.text
    assert "contraindications or safety checks" in stream_response.text
    assert '"type": "done"' in stream_response.text

    saved_response = await client.get(
        f"/api/sessions/{session.id}",
        headers=auth_headers,
    )
    assert saved_response.status_code == 200
    saved_session = saved_response.json()
    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "student",
        "coach",
    ]
    assert saved_session["messages"][1]["reasoning_score"] is None
    assert "Pause the management plan" in saved_session["messages"][2]["content"]
    assert saved_session["reasoning_map"]["nodes"] == []

    async with TestSessionLocal() as safety_db:
        safety_events = (
            await safety_db.execute(
                select(SafetyEvent).where(SafetyEvent.session_id == session.id)
            )
        ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].event_type == "management_before_safety_checks"
    assert safety_events[0].severity == "medium"
    assert safety_events[0].action_taken == "coach_redirected_to_safety_checks"
    assert safety_events[0].detected_terms == ["intubation"]
    assert "Aortic dissection features before anticoagulation" in safety_events[0].note
    assert safety_events[0].status == "open"


@pytest.mark.asyncio
async def test_premature_discharge_before_red_flags_redirects_and_records_safety_event(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("LLM coaching should not run before disposition safety redirect")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Reasoning analysis should not run before disposition safety redirect")

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

    user = User(
        email=f"premature-discharge-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Premature Discharge Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case presentation.",
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    stream_response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "I would discharge him home now with outpatient follow-up."},
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert "Pause the management plan" in stream_response.text
    assert "contraindications or safety checks" in stream_response.text
    assert '"type": "done"' in stream_response.text

    saved_response = await client.get(
        f"/api/sessions/{session.id}",
        headers=auth_headers,
    )
    assert saved_response.status_code == 200
    saved_session = saved_response.json()
    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "student",
        "coach",
    ]
    assert saved_session["messages"][1]["reasoning_score"] is None
    assert "Pause the management plan" in saved_session["messages"][2]["content"]
    assert saved_session["reasoning_map"]["nodes"] == []

    async with TestSessionLocal() as safety_db:
        safety_events = (
            await safety_db.execute(
                select(SafetyEvent).where(SafetyEvent.session_id == session.id)
            )
        ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].event_type == "management_before_safety_checks"
    assert safety_events[0].severity == "medium"
    assert safety_events[0].action_taken == "coach_redirected_to_safety_checks"
    assert safety_events[0].detected_terms == ["discharge", "outpatient follow-up"]
    assert "red flags: Diaphoresis with crushing chest pain" in safety_events[0].note
    assert "time-critical actions: 12-lead ECG within 10 minutes" in safety_events[0].note
    assert safety_events[0].status == "open"


@pytest.mark.asyncio
async def test_transfusion_before_safety_checks_redirects_and_records_safety_event(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("LLM coaching should not run before transfusion safety redirect")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Reasoning analysis should not run before transfusion safety redirect")

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

    user = User(
        email=f"transfusion-safety-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Transfusion Safety Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case presentation.",
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    stream_response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "In this simulation I would transfuse packed RBCs now."},
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert "Pause the management plan" in stream_response.text
    assert "contraindications or safety checks" in stream_response.text
    assert '"type": "done"' in stream_response.text

    saved_response = await client.get(
        f"/api/sessions/{session.id}",
        headers=auth_headers,
    )
    assert saved_response.status_code == 200
    saved_session = saved_response.json()
    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "student",
        "coach",
    ]
    assert saved_session["messages"][1]["reasoning_score"] is None
    assert "Pause the management plan" in saved_session["messages"][2]["content"]
    assert saved_session["reasoning_map"]["nodes"] == []

    async with TestSessionLocal() as safety_db:
        safety_events = (
            await safety_db.execute(
                select(SafetyEvent).where(SafetyEvent.session_id == session.id)
            )
        ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].event_type == "management_before_safety_checks"
    assert safety_events[0].severity == "medium"
    assert safety_events[0].action_taken == "coach_redirected_to_safety_checks"
    assert safety_events[0].detected_terms == ["packed rbcs"]
    assert safety_events[0].status == "open"


@pytest.mark.asyncio
async def test_korean_management_before_safety_checks_redirects_and_records_safety_event(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(sessions_router, "AsyncSessionLocal", TestSessionLocal)

    async def fail_stream_coach_response(**_kwargs):
        raise AssertionError("LLM coaching should not run before safety redirect")
        yield

    async def fail_analyze_student_response(**_kwargs):
        raise AssertionError("Reasoning analysis should not run before safety redirect")

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

    user = User(
        email=f"korean-management-safety-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Korean Management Safety Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="coach",
        content="Opening case presentation.",
    ))
    await db.commit()
    await db.refresh(user)
    await db.refresh(session)
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    stream_response = await client.post(
        f"/api/sessions/{session.id}/stream",
        json={"content": "이 시뮬레이션에서는 헤파린을 바로 시작하겠습니다."},
        headers=auth_headers,
    )

    assert stream_response.status_code == 200
    assert "Pause the management plan" in stream_response.text
    assert '"type": "done"' in stream_response.text

    saved_response = await client.get(
        f"/api/sessions/{session.id}",
        headers=auth_headers,
    )
    assert saved_response.status_code == 200
    saved_session = saved_response.json()
    assert [message["role"] for message in saved_session["messages"]] == [
        "coach",
        "student",
        "coach",
    ]
    assert saved_session["messages"][1]["reasoning_score"] is None
    assert "Pause the management plan" in saved_session["messages"][2]["content"]
    assert saved_session["reasoning_map"]["nodes"] == []

    async with TestSessionLocal() as safety_db:
        safety_events = (
            await safety_db.execute(
                select(SafetyEvent).where(SafetyEvent.session_id == session.id)
            )
        ).scalars().all()
    assert len(safety_events) == 1
    assert safety_events[0].event_type == "management_before_safety_checks"
    assert safety_events[0].detected_terms == ["heparin"]


@pytest.mark.asyncio
async def test_patient_identifier_signal_blocks_storage_and_records_safety_event(
    client: AsyncClient,
    db: AsyncSession,
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
    await _mark_case_clinician_reviewed_for_test(db, case_response.json()["id"])
    session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": case_response.json()["id"],
            "acknowledge_educational_simulation": True,
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
    assert saved_session["status"] == "safety_locked"
    assert saved_session["completed_at"] is None
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
    assert safety_events[0].action_taken == "locked_session_blocked_storage_and_coaching"
    assert safety_events[0].detected_terms == [
        "phone_number",
        "medical_record_number",
        "date_of_birth",
        "full_date",
        "name_identifier",
    ]
    assert "John Smith" not in str(safety_events[0].detected_terms)
    assert [message.role for message in messages] == ["coach", "coach"]

    repeat_response = await client.post(
        f"/api/sessions/{session_id}/stream",
        json={"content": "Can I continue this session now?"},
        headers=auth_headers,
    )
    assert repeat_response.status_code == 400
    assert repeat_response.json()["detail"] == "Session is not active"


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
        key_teaching_points=[
            "Obtain ECG early in acute chest pain",
            "Risk-stratify life-threatening chest pain before reassurance",
            "Check contraindications before antithrombotic treatment",
        ],
        cognitive_traps=[
            "Anchoring",
            "Premature closure after borderline troponin",
        ],
        clinical_red_flags=[
            "Diaphoresis with crushing chest pain",
            "Hypoxia or hemodynamic instability",
        ],
        time_critical_actions=[
            "12-lead ECG within 10 minutes",
            "Serial troponin trend",
        ],
        contraindication_checks=[
            "Aortic dissection features before anticoagulation",
            "Major bleeding risk before antiplatelet therapy",
        ],
        clinical_sources=[
            {
                "title": "2021 AHA/ACC Chest Pain Guideline",
                "organization": "American Heart Association / American College of Cardiology",
                "url": "https://www.jacc.org/doi/10.1016/j.jacc.2021.07.052",
                "supports": [
                    "ACS diagnosis and risk stratification for acute chest pain",
                    "life-threatening chest pain differential and severity markers",
                    "diaphoresis with crushing chest pain and hypoxia or hemodynamic instability",
                    "12-lead ECG within 10 minutes and serial troponin trend",
                    "aortic dissection features before anticoagulation",
                    "major bleeding risk before antiplatelet therapy",
                ],
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
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=(
            "I prioritized diaphoresis with crushing chest pain, want an ECG within "
            "10 minutes, and would check for aortic dissection before anticoagulation."
        ),
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
    assert "simulated clinical reasoning practice only" in payload["educational_notice"]
    assert "not patient care" in payload["educational_notice"]
    assert "revealed only after simulation completion" in payload["diagnosis_notice"]
    assert "real patients" in payload["diagnosis_notice"]
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
    assert payload["key_teaching_points"] == [
        "Obtain ECG early in acute chest pain",
        "Risk-stratify life-threatening chest pain before reassurance",
        "Check contraindications before antithrombotic treatment",
    ]
    assert payload["cognitive_traps"] == [
        "Anchoring",
        "Premature closure after borderline troponin",
    ]
    assert payload["clinical_sources"] == [
        {
            "title": "2021 AHA/ACC Chest Pain Guideline",
            "organization": "American Heart Association / American College of Cardiology",
            "url": "https://www.jacc.org/doi/10.1016/j.jacc.2021.07.052",
            "supports": [
                "ACS diagnosis and risk stratification for acute chest pain",
                "life-threatening chest pain differential and severity markers",
                "diaphoresis with crushing chest pain and hypoxia or hemodynamic instability",
                "12-lead ECG within 10 minutes and serial troponin trend",
                "aortic dissection features before anticoagulation",
                "major bleeding risk before antiplatelet therapy",
            ],
        }
    ]
    coverage = payload["clinical_safety_coverage"]
    assert coverage["covered_count"] == 3
    assert coverage["total_count"] == 6
    assert payload["clinical_safety_completion"] == {
        "complete": False,
        "message": (
            "This completed session has incomplete hidden clinical safety coverage. "
            "Treat the review as incomplete educational feedback, not evidence of "
            "safe clinical readiness."
        ),
        "uncovered_categories": [
            {"category": "red_flags", "label": "Red flags", "missing_count": 1},
            {
                "category": "time_critical_actions",
                "label": "Time-critical actions",
                "missing_count": 1,
            },
            {
                "category": "contraindication_checks",
                "label": "Contraindication checks",
                "missing_count": 1,
            },
        ],
    }
    assert payload["source_provenance"]["review_status"] == "educational_draft"
    assert payload["source_provenance"]["review_label"] == "Educational draft"
    assert payload["source_provenance"]["requires_caution"] is True
    assert payload["review_audit"] is None
    assert coverage["red_flags"][0] == {
        "item": "Diaphoresis with crushing chest pain",
        "covered": True,
        "evidence_turns": [1],
        "evidence": [
            {
                "turn": 1,
                "excerpt": (
                    "I prioritized diaphoresis with crushing chest pain, want an ECG "
                    "within 10 minutes, and would check for aortic dissection before "
                    "anticoagulation."
                ),
            }
        ],
    }
    assert coverage["red_flags"][1] == {
        "item": "Hypoxia or hemodynamic instability",
        "covered": False,
        "evidence_turns": [],
        "evidence": [],
    }
    assert coverage["time_critical_actions"][0]["covered"] is True
    assert coverage["time_critical_actions"][0]["evidence"][0]["turn"] == 1
    assert "want an ECG within 10 minutes" in (
        coverage["time_critical_actions"][0]["evidence"][0]["excerpt"]
    )
    assert coverage["time_critical_actions"][1]["covered"] is False
    assert coverage["contraindication_checks"][0]["covered"] is True
    assert "would check for aortic dissection" in (
        coverage["contraindication_checks"][0]["evidence"][0]["excerpt"]
    )
    assert coverage["contraindication_checks"][1]["covered"] is False
    assert payload["review_status"] == "educational_draft"
    assert "coach_guidance" not in payload


@pytest.mark.asyncio
async def test_session_review_filters_unsafe_stored_feedback_text(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"review-feedback-safety-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Review Feedback Safety Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="completed",
        final_reasoning_score=84,
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=84,
        reasoning_analysis={
            "score_breakdown": {
                "systematic_approach": 21,
                "evidence_integration": 20,
                "prioritization": 22,
                "mechanism_understanding": 19,
            },
            "strengths": [
                "Prioritized dangerous alternatives before narrowing the differential.",
                "You should give aspirin now.",
            ],
            "gaps": [
                "Needs clearer safety checks before management.",
                "Heparin can be 60 units/kg.",
                "The patient can go home with outpatient follow-up.",
            ],
            "coach_insight": "Start heparin now after the ECG.",
        },
    ))
    db.add(Message(
        session_id=session.id,
        role="student",
        content="I would revisit the differential as new information arrives.",
        reasoning_score=86,
        reasoning_analysis={
            "score_breakdown": {
                "systematic_approach": 22,
                "evidence_integration": 21,
                "prioritization": 22,
                "mechanism_understanding": 20,
            },
            "strengths": ["Prioritized dangerous alternatives before narrowing the differential."],
            "gaps": ["Needs explicit disconfirming evidence."],
            "coach_insight": "Ask for disconfirming evidence before closure.",
        },
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.get(
        f"/api/sessions/{session.id}/review",
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["strengths"] == [
        "Prioritized dangerous alternatives before narrowing the differential."
    ]
    assert payload["gaps"] == [
        "Needs clearer safety checks before management.",
        "Needs explicit disconfirming evidence.",
    ]
    assert payload["coach_insights"] == [
        "Ask for disconfirming evidence before closure."
    ]
    assert "aspirin" not in str(payload["strengths"]).lower()
    assert "60 units/kg" not in str(payload["gaps"]).lower()
    assert "go home" not in str(payload["gaps"]).lower()
    assert "heparin" not in str(payload["coach_insights"]).lower()


@pytest.mark.asyncio
async def test_session_review_bounds_stored_breakdown_and_bias_confidence(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email=f"review-bounds-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Review Bounds Tester",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case(review_status="clinician_reviewed")
    db.add_all([user, case])
    await db.flush()
    session = CoachingSession(
        user_id=user.id,
        case_id=case.id,
        status="completed",
        final_reasoning_score=82,
        reasoning_map={"nodes": [], "edges": []},
        review_snapshot=_session_review_snapshot_for_case(case),
    )
    db.add(session)
    await db.flush()
    db.add(Message(
        session_id=session.id,
        role="student",
        content=COMPLETE_ACS_SAFETY_REASONING,
        reasoning_score=82,
        reasoning_analysis={
            "score_breakdown": {
                "systematic_approach": 40,
                "evidence_integration": -5,
                "prioritization": "18",
                "mechanism_understanding": "not a number",
                "unsupported_dimension": 99,
            },
            "strengths": ["Prioritized dangerous diagnoses"],
            "gaps": ["Needs more disconfirming evidence"],
            "coach_insight": "Good initial safety framing.",
        },
    ))
    db.add(BiasEvent(
        session_id=session.id,
        user_id=user.id,
        bias_type="anchoring",
        severity="catastrophic",
        evidence="Focused on ACS before explicitly considering alternatives.",
        confidence=2.4,
        message_turn=1,
    ))
    await db.commit()
    auth_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.get(
        f"/api/sessions/{session.id}/review",
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source_provenance"]["review_status"] == "clinician_reviewed"
    assert payload["source_provenance"]["review_label"] == "Clinician reviewed"
    assert payload["source_provenance"]["requires_caution"] is False
    assert payload["source_provenance"]["review_audit_missing"] is False
    assert payload["review_audit"] == {
        "confirmations": {
            "clinical_accuracy_confirmed": True,
            "source_alignment_confirmed": True,
            "educational_safety_confirmed": True,
        },
        "source_alignment_checks": {
            "teaching_points_supported": True,
            "red_flags_supported": True,
            "time_critical_actions_supported": True,
            "contraindication_checks_supported": True,
        },
        "review_notes": "Test clinician review with source and safety alignment.",
    }
    assert payload["score_breakdown"] == {
        "systematic_approach": 25.0,
        "evidence_integration": 0.0,
        "prioritization": 18.0,
        "mechanism_understanding": 0.0,
    }
    assert payload["clinical_safety_completion"] == {
        "complete": True,
        "message": (
            "All configured hidden clinical safety targets were addressed before "
            "this simulated learning review."
        ),
        "uncovered_categories": [],
    }
    assert "unsupported_dimension" not in payload["score_breakdown"]
    assert payload["bias_feedback"] == [
        {
            "bias_type": "anchoring",
            "severity": "mild",
            "evidence": "Focused on ACS before explicitly considering alternatives.",
            "confidence": 1.0,
            "message_turn": 1,
        }
    ]
