from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.case import ClinicalCase
from app.models.safety_event import SafetyEvent
from app.models.session import CoachingSession
from app.models.user import User
from app.utils.auth import create_access_token, hash_password


def _auth_headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def _make_case() -> ClinicalCase:
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
        review_status="clinician_reviewed",
        last_reviewed_at=date.today().isoformat(),
        coach_guidance="Use Socratic questioning.",
    )


@pytest.mark.asyncio
async def test_safety_events_require_clinician_reviewer_role(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"safety-learner-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Learner",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    db.add(learner)
    await db.commit()
    await db.refresh(learner)

    response = await client.get("/api/safety-events", headers=_auth_headers(learner))

    assert response.status_code == 403
    assert response.json()["detail"] == "Clinician reviewer role required"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("query", "field", "allowed_value"),
    [
        (
            "event_type=unknown_event",
            "event_type",
            "real_patient_or_emergency_signal",
        ),
        ("severity=critical", "severity", "high"),
        ("event_status=closed", "event_status", "resolved"),
    ],
)
async def test_safety_events_reject_invalid_audit_filters(
    client: AsyncClient,
    db: AsyncSession,
    query: str,
    field: str,
    allowed_value: str,
):
    reviewer = User(
        email=f"safety-filter-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Filter Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    db.add(reviewer)
    await db.commit()
    await db.refresh(reviewer)

    response = await client.get(
        f"/api/safety-events?{query}",
        headers=_auth_headers(reviewer),
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_safety_event_filter"
    assert response.json()["detail"]["field"] == field
    assert allowed_value in response.json()["detail"]["allowed_values"]


@pytest.mark.asyncio
async def test_update_safety_event_resolution_returns_structured_not_found(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"safety-missing-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Missing Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    db.add(reviewer)
    await db.commit()
    await db.refresh(reviewer)

    response = await client.patch(
        f"/api/safety-events/{uuid.uuid4()}/resolution",
        headers=_auth_headers(reviewer),
        json={
            "status": "resolved",
            "resolution_note": "Reviewed audit trail and escalated to supervising clinician.",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "safety_event_not_found",
        "message": "Safety event not found",
    }


@pytest.mark.asyncio
async def test_reviewer_can_list_and_filter_safety_events(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"safety-event-learner-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Event Learner",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    reviewer = User(
        email=f"safety-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case()
    db.add_all([learner, reviewer, case])
    await db.flush()
    session = CoachingSession(
        user_id=learner.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.flush()
    db.add_all([
        SafetyEvent(
            session_id=session.id,
            user_id=learner.id,
            event_type="real_patient_or_emergency_signal",
            severity="high",
            action_taken="halted_coaching",
            detected_terms=["severe chest pain"],
            message_turn=1,
            note="Coaching halted for possible real patient or emergency scenario.",
        ),
        SafetyEvent(
            session_id=session.id,
            user_id=learner.id,
            event_type="possible_patient_identifier",
            severity="high",
            action_taken="blocked_storage_and_coaching",
            detected_terms=["phone_number"],
            message_turn=2,
            note="Student message was not stored.",
        ),
    ])
    await db.commit()
    await db.refresh(reviewer)

    response = await client.get(
        "/api/safety-events?event_type=possible_patient_identifier",
        headers=_auth_headers(reviewer),
    )

    assert response.status_code == 200
    payload = response.json()
    item = next(event for event in payload if event["session_id"] == str(session.id))
    assert item["event_type"] == "possible_patient_identifier"
    assert item["action_taken"] == "blocked_storage_and_coaching"
    assert item["detected_terms"] == ["phone_number"]
    assert item["user_email"] == learner.email
    assert item["user_full_name"] == learner.full_name
    assert item["case_id"] == str(case.id)
    assert item["session_status"] == "active"
    assert item["status"] == "open"
    assert item["resolution_note"] is None
    assert item["resolved_at"] is None
    assert item["resolved_by_user_id"] is None
    assert item["resolved_by_user_email"] is None
    assert item["resolved_by_user_full_name"] is None


@pytest.mark.asyncio
async def test_reviewer_can_resolve_safety_event(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"safety-resolve-learner-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Resolve Learner",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    reviewer = User(
        email=f"safety-resolver-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Resolver",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case()
    db.add_all([learner, reviewer, case])
    await db.flush()
    session = CoachingSession(
        user_id=learner.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.flush()
    event = SafetyEvent(
        session_id=session.id,
        user_id=learner.id,
        event_type="real_patient_or_emergency_signal",
        severity="high",
        action_taken="halted_coaching",
        detected_terms=["right now"],
        message_turn=1,
        note="Coaching halted.",
    )
    db.add(event)
    await db.commit()
    await db.refresh(reviewer)
    await db.refresh(event)

    response = await client.patch(
        f"/api/safety-events/{event.id}/resolution",
        headers=_auth_headers(reviewer),
        json={
            "status": "resolved",
            "resolution_note": "Reviewed and escalated to program director.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "resolved"
    assert payload["session_status"] == "active"
    assert payload["resolution_note"] == "Reviewed and escalated to program director."
    assert payload["resolved_at"] is not None
    assert payload["resolved_by_user_id"] == str(reviewer.id)
    assert payload["resolved_by_user_email"] == reviewer.email
    assert payload["resolved_by_user_full_name"] == reviewer.full_name

    list_response = await client.get(
        "/api/safety-events?event_status=resolved",
        headers=_auth_headers(reviewer),
    )
    assert list_response.status_code == 200
    resolved_event_ids = [item["id"] for item in list_response.json()]
    assert str(event.id) in resolved_event_ids

    open_response = await client.get(
        "/api/safety-events?event_status=open",
        headers=_auth_headers(reviewer),
    )
    assert open_response.status_code == 200
    assert str(event.id) not in [item["id"] for item in open_response.json()]

    reopen_response = await client.patch(
        f"/api/safety-events/{event.id}/resolution",
        headers=_auth_headers(reviewer),
        json={
            "status": "open",
            "resolution_note": "This stale note must be cleared when reopening.",
        },
    )
    assert reopen_response.status_code == 200
    reopened_payload = reopen_response.json()
    assert reopened_payload["status"] == "open"
    assert reopened_payload["resolution_note"] is None
    assert reopened_payload["resolved_at"] is None
    assert reopened_payload["resolved_by_user_id"] is None


@pytest.mark.asyncio
async def test_resolving_safety_event_does_not_unlock_session(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"safety-lock-learner-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Lock Learner",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    reviewer = User(
        email=f"safety-lock-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Lock Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case()
    db.add_all([learner, reviewer, case])
    await db.flush()
    session = CoachingSession(
        user_id=learner.id,
        case_id=case.id,
        status="safety_locked",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.flush()
    event = SafetyEvent(
        session_id=session.id,
        user_id=learner.id,
        event_type="real_patient_or_emergency_signal",
        severity="high",
        action_taken="locked_session_and_halted_coaching",
        detected_terms=["right now"],
        message_turn=1,
        note="Session was locked and coaching halted.",
    )
    db.add(event)
    await db.commit()
    await db.refresh(reviewer)
    await db.refresh(event)

    response = await client.patch(
        f"/api/safety-events/{event.id}/resolution",
        headers=_auth_headers(reviewer),
        json={
            "status": "resolved",
            "resolution_note": "Reviewed audit trail and escalated outside the app.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "resolved"
    assert payload["session_status"] == "safety_locked"
    await db.refresh(session)
    assert session.status == "safety_locked"


@pytest.mark.asyncio
async def test_reviewer_must_document_resolution_note(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"safety-note-learner-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Note Learner",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    reviewer = User(
        email=f"safety-note-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Note Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case()
    db.add_all([learner, reviewer, case])
    await db.flush()
    session = CoachingSession(
        user_id=learner.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.flush()
    event = SafetyEvent(
        session_id=session.id,
        user_id=learner.id,
        event_type="real_patient_or_emergency_signal",
        severity="high",
        action_taken="halted_coaching",
        detected_terms=["right now"],
        message_turn=1,
        note="Coaching halted.",
    )
    db.add(event)
    await db.commit()
    await db.refresh(reviewer)
    await db.refresh(event)

    cases = [
        (
            "   ",
            {
                "code": "safety_resolution_note_required",
                "message": (
                    "Resolution note is required before marking an event resolved."
                ),
            },
        ),
        (
            "done",
            {
                "code": "safety_resolution_note_too_short",
                "message": "Resolution note must summarize the safety review or escalation.",
                "minimum_length": 20,
            },
        ),
        (
            "Learner finished the session successfully.",
            {
                "code": "safety_resolution_note_context_missing",
                "message": (
                    "Resolution note must mention review, escalation, or how the "
                    "issue was addressed."
                ),
            },
        ),
    ]
    for resolution_note, expected_detail in cases:
        response = await client.patch(
            f"/api/safety-events/{event.id}/resolution",
            headers=_auth_headers(reviewer),
            json={"status": "resolved", "resolution_note": resolution_note},
        )

        assert response.status_code == 422
        detail = response.json()["detail"]
        for key, value in expected_detail.items():
            assert detail[key] == value
        if detail["code"] == "safety_resolution_note_context_missing":
            assert "reviewed" in detail["required_terms"]


@pytest.mark.asyncio
async def test_high_risk_lock_event_resolution_requires_escalation_or_privacy_context(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"safety-high-risk-learner-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety High Risk Learner",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    reviewer = User(
        email=f"safety-high-risk-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety High Risk Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case()
    db.add_all([learner, reviewer, case])
    await db.flush()
    session = CoachingSession(
        user_id=learner.id,
        case_id=case.id,
        status="safety_locked",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.flush()
    event = SafetyEvent(
        session_id=session.id,
        user_id=learner.id,
        event_type="possible_patient_identifier",
        severity="high",
        action_taken="locked_session_blocked_storage_and_coaching",
        detected_terms=["medical_record_number"],
        message_turn=1,
        note="Session was locked and message storage was blocked.",
    )
    db.add(event)
    await db.commit()
    await db.refresh(reviewer)
    await db.refresh(event)

    incomplete_response = await client.patch(
        f"/api/safety-events/{event.id}/resolution",
        headers=_auth_headers(reviewer),
        json={
            "status": "resolved",
            "resolution_note": "Reviewed the audit trail and documented the event.",
        },
    )

    assert incomplete_response.status_code == 422
    assert incomplete_response.json()["detail"]["code"] == (
        "high_risk_safety_resolution_note_incomplete"
    )

    complete_response = await client.patch(
        f"/api/safety-events/{event.id}/resolution",
        headers=_auth_headers(reviewer),
        json={
            "status": "resolved",
            "resolution_note": (
                "감사 기록을 검토하고 개인정보 처리 후 지도전문의에게 보고했습니다."
            ),
        },
    )

    assert complete_response.status_code == 200
    payload = complete_response.json()
    assert payload["status"] == "resolved"
    assert payload["resolution_note"] == (
        "감사 기록을 검토하고 개인정보 처리 후 지도전문의에게 보고했습니다."
    )


@pytest.mark.asyncio
async def test_learner_cannot_resolve_safety_event(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = User(
        email=f"safety-resolve-blocked-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("safetypass123"),
        full_name="Safety Resolve Blocked",
        training_level="resident",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = _make_case()
    db.add_all([learner, case])
    await db.flush()
    session = CoachingSession(
        user_id=learner.id,
        case_id=case.id,
        status="active",
        reasoning_map={"nodes": [], "edges": []},
    )
    db.add(session)
    await db.flush()
    event = SafetyEvent(
        session_id=session.id,
        user_id=learner.id,
        event_type="possible_patient_identifier",
        severity="high",
        action_taken="blocked_storage_and_coaching",
        detected_terms=["phone_number"],
        message_turn=1,
        note="Student message was not stored.",
    )
    db.add(event)
    await db.commit()
    await db.refresh(learner)
    await db.refresh(event)

    response = await client.patch(
        f"/api/safety-events/{event.id}/resolution",
        headers=_auth_headers(learner),
        json={"status": "resolved", "resolution_note": "Learner cannot resolve."},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Clinician reviewer role required"
