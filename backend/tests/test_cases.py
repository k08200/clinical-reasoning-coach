from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.case import ClinicalCase
from app.models.case_review import ClinicalCaseReview
from app.models.user import User
from app.routers import cases as cases_router
from app.schemas.case import ClinicalCaseCreate
from app.services.mock_provider import CASE_POOL
from app.services.case_quality import evaluate_case_quality
from app.utils.auth import create_access_token, hash_password


async def _register_and_login(client: AsyncClient) -> dict[str, str]:
    email = f"case-test-{uuid.uuid4()}@test.com"
    register_response = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "casespass123",
            "full_name": "Case Tester",
            "training_level": "resident",
            "accepted_educational_use": True,
        },
    )
    assert register_response.status_code == 201
    login_response = await client.post(
        "/api/auth/token",
        data={"username": email, "password": "casespass123"},
    )
    assert login_response.status_code == 200
    return {
        "Authorization": f"Bearer {login_response.json()['access_token']}",
    }


def test_curated_cases_include_hidden_safety_metadata():
    for case in CASE_POOL:
        assert case["clinical_red_flags"], case["title"]
        assert case["time_critical_actions"], case["title"]
        assert case["contraindication_checks"], case["title"]
        assert case["clinical_sources"], case["title"]
        assert all(source.get("url") for source in case["clinical_sources"]), case["title"]
        assert case["review_status"] in {"educational_draft", "clinician_reviewed"}
        assert case["last_reviewed_at"], case["title"]
        assert evaluate_case_quality(case).passed, case["title"]


async def test_case_response_does_not_expose_answer_or_hidden_safety_metadata(
    client: AsyncClient,
):
    email = f"case-safety-{uuid.uuid4()}@test.com"
    register_response = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "casespass123",
            "full_name": "Case Safety Tester",
            "training_level": "resident",
            "accepted_educational_use": True,
        },
    )
    assert register_response.status_code == 201
    login_response = await client.post(
        "/api/auth/token",
        data={"username": email, "password": "casespass123"},
    )
    assert login_response.status_code == 200
    auth_headers = {
        "Authorization": f"Bearer {login_response.json()['access_token']}",
    }

    response = await client.post("/api/cases/generate/demo", headers=auth_headers)

    assert response.status_code == 201
    payload = response.json()
    assert "diagnosis" not in payload
    assert "coach_guidance" not in payload
    assert "clinical_red_flags" not in payload
    assert "time_critical_actions" not in payload
    assert "contraindication_checks" not in payload
    assert "clinical_sources" not in payload
    assert "review_status" not in payload
    assert "last_reviewed_at" not in payload
    assert payload["source_provenance"]["source_count"] == 1
    assert payload["source_provenance"]["organizations"]
    assert payload["source_provenance"]["review_status"] == "educational_draft"
    assert payload["source_provenance"]["review_label"] == "Educational draft"
    assert payload["source_provenance"]["requires_caution"] is True
    assert payload["source_provenance"]["last_reviewed_at"] == "2026-06-01"
    assert "url" not in payload["source_provenance"]
    assert "title" not in payload["source_provenance"]
    assert "supports" not in payload["source_provenance"]


async def test_dynamic_generation_requires_unreviewed_acknowledgement(
    client: AsyncClient,
):
    auth_headers = await _register_and_login(client)
    response = await client.post(
        "/api/cases/generate",
        headers=auth_headers,
        json={"specialty": "internal_medicine", "difficulty": "medium"},
    )

    assert response.status_code == 400
    assert "unreviewed" in response.json()["detail"].lower()


async def test_dynamic_generation_forces_unreviewed_provenance(
    client: AsyncClient,
    monkeypatch,
):
    auth_headers = await _register_and_login(client)

    async def fake_generate_clinical_case(**_kwargs) -> ClinicalCaseCreate:
        raw_case = dict(CASE_POOL[0])
        raw_case["review_status"] = "clinician_reviewed"
        raw_case["last_reviewed_at"] = "2026-06-01"
        return ClinicalCaseCreate(**raw_case)

    monkeypatch.setattr(
        cases_router,
        "generate_clinical_case",
        fake_generate_clinical_case,
    )

    response = await client.post(
        "/api/cases/generate",
        headers=auth_headers,
        json={
            "specialty": "internal_medicine",
            "difficulty": "medium",
            "acknowledge_unreviewed_generation": True,
        },
    )

    assert response.status_code == 201
    provenance = response.json()["source_provenance"]
    assert provenance["review_status"] == "ai_generated_unreviewed"
    assert provenance["review_label"] == "AI-generated, unreviewed"
    assert provenance["requires_caution"] is True
    assert provenance["last_reviewed_at"] is None


async def test_stale_clinician_review_provenance_requires_caution(
    client: AsyncClient,
    db: AsyncSession,
):
    auth_headers = await _register_and_login(client)
    case_payload = dict(CASE_POOL[0])
    case_payload["review_status"] = "clinician_reviewed"
    case_payload["last_reviewed_at"] = "2024-01-01"
    case = ClinicalCase(**case_payload)
    db.add(case)
    await db.commit()
    await db.refresh(case)

    response = await client.get(f"/api/cases/{case.id}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    provenance = payload["source_provenance"]
    assert provenance["review_status"] == "clinician_reviewed"
    assert provenance["review_label"] == "Clinician review stale"
    assert provenance["requires_caution"] is True
    assert provenance["review_stale"] is True
    assert provenance["last_reviewed_at"] == "2024-01-01"
    assert provenance["review_valid_until"] == "2024-12-31"


async def test_learner_cannot_mark_case_clinician_reviewed(
    client: AsyncClient,
):
    auth_headers = await _register_and_login(client)
    case_response = await client.post(
        "/api/cases/generate/demo",
        headers=auth_headers,
    )
    assert case_response.status_code == 201

    response = await client.post(
        f"/api/cases/{case_response.json()['id']}/clinical-review",
        headers=auth_headers,
        json={
            "clinical_accuracy_confirmed": True,
            "source_alignment_confirmed": True,
            "educational_safety_confirmed": True,
            "review_notes": "Looks clinically sound for education.",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Clinician reviewer role required"


async def test_learner_cannot_access_clinical_review_detail(
    client: AsyncClient,
    db: AsyncSession,
):
    learner_headers = await _register_and_login(client)
    case = ClinicalCase(**CASE_POOL[0])
    db.add(case)
    await db.commit()
    await db.refresh(case)

    response = await client.get(
        f"/api/cases/{case.id}/clinical-review/detail",
        headers=learner_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Clinician reviewer role required"


async def test_clinician_reviewer_can_mark_case_reviewed(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Clinician Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = ClinicalCase(**CASE_POOL[0])
    db.add_all([reviewer, case])
    await db.commit()
    await db.refresh(reviewer)
    await db.refresh(case)
    reviewer_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(reviewer.id)})}",
    }

    response = await client.post(
        f"/api/cases/{case.id}/clinical-review",
        headers=reviewer_headers,
        json={
            "clinical_accuracy_confirmed": True,
            "source_alignment_confirmed": True,
            "educational_safety_confirmed": True,
            "review_notes": "Reviewed against cited educational source.",
        },
    )

    assert response.status_code == 200
    provenance = response.json()["source_provenance"]
    assert provenance["review_status"] == "clinician_reviewed"
    assert provenance["review_label"] == "Clinician reviewed"
    assert provenance["requires_caution"] is False
    assert provenance["last_reviewed_at"] == date.today().isoformat()

    await db.refresh(case)
    assert case.reviewed_by_user_id == reviewer.id
    assert case.review_notes == "Reviewed against cited educational source."

    history_response = await client.get(
        f"/api/cases/{case.id}/clinical-review/history",
        headers=reviewer_headers,
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history) == 1
    assert history[0]["case_id"] == str(case.id)
    assert history[0]["reviewer_user_id"] == str(reviewer.id)
    assert history[0]["prior_review_status"] == "educational_draft"
    assert history[0]["resulting_review_status"] == "clinician_reviewed"
    assert history[0]["confirmations"] == {
        "clinical_accuracy_confirmed": True,
        "source_alignment_confirmed": True,
        "educational_safety_confirmed": True,
    }
    assert history[0]["source_snapshot"]["source_count"] == 1
    assert history[0]["source_snapshot"]["organizations"]


async def test_clinical_review_requires_complete_safety_metadata(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"quality-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Quality Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case_payload = dict(CASE_POOL[0])
    case_payload["clinical_red_flags"] = []
    case = ClinicalCase(**case_payload)
    db.add_all([reviewer, case])
    await db.commit()
    await db.refresh(reviewer)
    await db.refresh(case)
    reviewer_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(reviewer.id)})}",
    }

    response = await client.post(
        f"/api/cases/{case.id}/clinical-review",
        headers=reviewer_headers,
        json={
            "clinical_accuracy_confirmed": True,
            "source_alignment_confirmed": True,
            "educational_safety_confirmed": True,
            "review_notes": "Trying to approve incomplete safety metadata.",
        },
    )

    assert response.status_code == 409
    assert "case quality gate" in response.json()["detail"]
    assert "clinical red flags" in response.json()["detail"]
    await db.refresh(case)
    assert case.review_status == case_payload["review_status"]
    assert case.reviewed_by_user_id is None


async def test_clinician_reviewer_can_access_hidden_review_detail(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"detail-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Detail Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = ClinicalCase(**CASE_POOL[0])
    db.add_all([reviewer, case])
    await db.commit()
    await db.refresh(reviewer)
    await db.refresh(case)
    reviewer_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(reviewer.id)})}",
    }

    response = await client.get(
        f"/api/cases/{case.id}/clinical-review/detail",
        headers=reviewer_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["diagnosis"] == case.diagnosis
    assert payload["coach_guidance"] == case.coach_guidance
    assert payload["clinical_red_flags"] == case.clinical_red_flags
    assert payload["time_critical_actions"] == case.time_critical_actions
    assert payload["contraindication_checks"] == case.contraindication_checks
    assert payload["clinical_sources"] == case.clinical_sources
    assert payload["clinical_sources"][0]["url"]
    assert payload["clinical_sources"][0]["supports"]


async def test_clinical_review_history_requires_reviewer_role(
    client: AsyncClient,
    db: AsyncSession,
):
    learner_headers = await _register_and_login(client)
    case = ClinicalCase(**CASE_POOL[0])
    db.add(case)
    await db.commit()
    await db.refresh(case)

    response = await client.get(
        f"/api/cases/{case.id}/clinical-review/history",
        headers=learner_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Clinician reviewer role required"


async def test_clinical_review_writes_audit_log(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"audit-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Audit Reviewer",
        training_level="fellow",
        role="admin",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case = ClinicalCase(**CASE_POOL[0])
    db.add_all([reviewer, case])
    await db.commit()
    await db.refresh(reviewer)
    await db.refresh(case)
    reviewer_headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(reviewer.id)})}",
    }

    response = await client.post(
        f"/api/cases/{case.id}/clinical-review",
        headers=reviewer_headers,
        json={
            "clinical_accuracy_confirmed": True,
            "source_alignment_confirmed": True,
            "educational_safety_confirmed": True,
            "review_notes": "Audit trail confirmation.",
        },
    )

    assert response.status_code == 200
    result = await db.execute(
        select(ClinicalCaseReview).where(ClinicalCaseReview.case_id == case.id)
    )
    review = result.scalar_one()
    assert review.reviewer_user_id == reviewer.id
    assert review.prior_review_status == "educational_draft"
    assert review.resulting_review_status == "clinician_reviewed"
    assert review.review_notes == "Audit trail confirmation."
    assert review.source_snapshot["source_count"] == 1
