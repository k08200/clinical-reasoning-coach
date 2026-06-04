from __future__ import annotations

import copy
import uuid
from datetime import date, datetime, timezone

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.case import ClinicalCase
from app.models.case_review import ClinicalCaseReview
from app.models.user import User
from app.routers import cases as cases_router
from app.schemas.case import ClinicalCaseCreate, MAX_SEED_SCENARIO_LENGTH
from app.services.mock_provider import CASE_POOL
from app.services.case_quality import evaluate_case_quality
from app.utils.auth import create_access_token, hash_password

SOURCE_ALIGNMENT_CHECKS = {
    "teaching_points_supported": True,
    "red_flags_supported": True,
    "time_critical_actions_supported": True,
    "contraindication_checks_supported": True,
}


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
    assert "key_teaching_points" not in payload
    assert "cognitive_traps" not in payload
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


async def test_dynamic_generation_blocks_phi_seed_before_provider_call(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch,
):
    auth_headers = await _register_and_login(client)
    before_count = await db.scalar(select(func.count()).select_from(ClinicalCase))

    async def fail_generate_clinical_case(**_kwargs) -> ClinicalCaseCreate:
        raise AssertionError("PHI seed scenarios must not be sent to generation")

    monkeypatch.setattr(
        cases_router,
        "generate_clinical_case",
        fail_generate_clinical_case,
    )

    response = await client.post(
        "/api/cases/generate",
        headers=auth_headers,
        json={
            "specialty": "internal_medicine",
            "difficulty": "medium",
            "seed_scenario": (
                "Patient name is John Smith, DOB 01/02/1970, MRN A123456, "
                "with chest pain."
            ),
            "acknowledge_unreviewed_generation": True,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "seed_scenario_contains_patient_identifiers",
        "message": (
            "Seed scenarios must be de-identified educational prompts. "
            "Remove patient identifiers before generating a case."
        ),
        "detected_identifier_categories": [
            "medical_record_number",
            "date_of_birth",
            "full_date",
            "name_identifier",
        ],
    }
    after_count = await db.scalar(select(func.count()).select_from(ClinicalCase))
    assert after_count == before_count


async def test_dynamic_generation_blocks_exact_visit_date_seed_before_provider_call(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch,
):
    auth_headers = await _register_and_login(client)
    before_count = await db.scalar(select(func.count()).select_from(ClinicalCase))

    async def fail_generate_clinical_case(**_kwargs) -> ClinicalCaseCreate:
        raise AssertionError("Exact visit dates must not be sent to generation")

    monkeypatch.setattr(
        cases_router,
        "generate_clinical_case",
        fail_generate_clinical_case,
    )

    response = await client.post(
        "/api/cases/generate",
        headers=auth_headers,
        json={
            "specialty": "internal_medicine",
            "difficulty": "medium",
            "seed_scenario": (
                "A simulated chest pain case based on a visit from June 4, 2026."
            ),
            "acknowledge_unreviewed_generation": True,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "seed_scenario_contains_patient_identifiers",
        "message": (
            "Seed scenarios must be de-identified educational prompts. "
            "Remove patient identifiers before generating a case."
        ),
        "detected_identifier_categories": ["full_date"],
    }
    after_count = await db.scalar(select(func.count()).select_from(ClinicalCase))
    assert after_count == before_count


async def test_dynamic_generation_blocks_exact_age_over_89_seed_before_provider_call(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch,
):
    auth_headers = await _register_and_login(client)
    before_count = await db.scalar(select(func.count()).select_from(ClinicalCase))

    async def fail_generate_clinical_case(**_kwargs) -> ClinicalCaseCreate:
        raise AssertionError("Exact ages over 89 must not be sent to generation")

    monkeypatch.setattr(
        cases_router,
        "generate_clinical_case",
        fail_generate_clinical_case,
    )

    response = await client.post(
        "/api/cases/generate",
        headers=auth_headers,
        json={
            "specialty": "internal_medicine",
            "difficulty": "medium",
            "seed_scenario": "Create a simulated case about a 92-year-old with fever.",
            "acknowledge_unreviewed_generation": True,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "seed_scenario_contains_patient_identifiers",
        "message": (
            "Seed scenarios must be de-identified educational prompts. "
            "Remove patient identifiers before generating a case."
        ),
        "detected_identifier_categories": ["age_over_89"],
    }
    after_count = await db.scalar(select(func.count()).select_from(ClinicalCase))
    assert after_count == before_count


async def test_dynamic_generation_blocks_korean_address_seed_before_provider_call(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch,
):
    auth_headers = await _register_and_login(client)
    before_count = await db.scalar(select(func.count()).select_from(ClinicalCase))

    async def fail_generate_clinical_case(**_kwargs) -> ClinicalCaseCreate:
        raise AssertionError("Korean addresses must not be sent to generation")

    monkeypatch.setattr(
        cases_router,
        "generate_clinical_case",
        fail_generate_clinical_case,
    )

    response = await client.post(
        "/api/cases/generate",
        headers=auth_headers,
        json={
            "specialty": "internal_medicine",
            "difficulty": "medium",
            "seed_scenario": (
                "주소는 서울특별시 강남구 테헤란로 123인 환자의 흉통 사례입니다."
            ),
            "acknowledge_unreviewed_generation": True,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "seed_scenario_contains_patient_identifiers",
        "message": (
            "Seed scenarios must be de-identified educational prompts. "
            "Remove patient identifiers before generating a case."
        ),
        "detected_identifier_categories": ["street_address"],
    }
    after_count = await db.scalar(select(func.count()).select_from(ClinicalCase))
    assert after_count == before_count


async def test_dynamic_generation_blocks_korean_resident_id_seed_before_provider_call(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch,
):
    auth_headers = await _register_and_login(client)
    before_count = await db.scalar(select(func.count()).select_from(ClinicalCase))

    async def fail_generate_clinical_case(**_kwargs) -> ClinicalCaseCreate:
        raise AssertionError("Korean resident IDs must not be sent to generation")

    monkeypatch.setattr(
        cases_router,
        "generate_clinical_case",
        fail_generate_clinical_case,
    )

    response = await client.post(
        "/api/cases/generate",
        headers=auth_headers,
        json={
            "specialty": "internal_medicine",
            "difficulty": "medium",
            "seed_scenario": "주민등록번호 900101-1234567인 환자의 복통 사례입니다.",
            "acknowledge_unreviewed_generation": True,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "seed_scenario_contains_patient_identifiers",
        "message": (
            "Seed scenarios must be de-identified educational prompts. "
            "Remove patient identifiers before generating a case."
        ),
        "detected_identifier_categories": ["social_security_number"],
    }
    after_count = await db.scalar(select(func.count()).select_from(ClinicalCase))
    assert after_count == before_count


async def test_dynamic_generation_blocks_real_patient_seed_before_provider_call(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch,
):
    auth_headers = await _register_and_login(client)
    before_count = await db.scalar(select(func.count()).select_from(ClinicalCase))

    async def fail_generate_clinical_case(**_kwargs) -> ClinicalCaseCreate:
        raise AssertionError("Real patient seed scenarios must not be sent to generation")

    monkeypatch.setattr(
        cases_router,
        "generate_clinical_case",
        fail_generate_clinical_case,
    )

    response = await client.post(
        "/api/cases/generate",
        headers=auth_headers,
        json={
            "specialty": "emergency_medicine",
            "difficulty": "medium",
            "seed_scenario": "My patient is deteriorating right now in clinic.",
            "acknowledge_unreviewed_generation": True,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "seed_scenario_real_patient_or_emergency",
        "message": (
            "Seed scenarios must not describe an active real patient or emergency. "
            "Use only clearly simulated educational prompts."
        ),
    }
    after_count = await db.scalar(select(func.count()).select_from(ClinicalCase))
    assert after_count == before_count


async def test_dynamic_generation_rejects_oversized_seed_before_provider_call(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch,
):
    auth_headers = await _register_and_login(client)
    before_count = await db.scalar(select(func.count()).select_from(ClinicalCase))

    async def fail_generate_clinical_case(**_kwargs) -> ClinicalCaseCreate:
        raise AssertionError("Oversized seed scenarios must not be sent to generation")

    monkeypatch.setattr(
        cases_router,
        "generate_clinical_case",
        fail_generate_clinical_case,
    )

    response = await client.post(
        "/api/cases/generate",
        headers=auth_headers,
        json={
            "specialty": "internal_medicine",
            "difficulty": "medium",
            "seed_scenario": "a" * (MAX_SEED_SCENARIO_LENGTH + 1),
            "acknowledge_unreviewed_generation": True,
        },
    )

    assert response.status_code == 422
    after_count = await db.scalar(select(func.count()).select_from(ClinicalCase))
    assert after_count == before_count


async def test_dynamic_generation_rejects_unsupported_specialty_and_difficulty(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch,
):
    auth_headers = await _register_and_login(client)
    before_count = await db.scalar(select(func.count()).select_from(ClinicalCase))

    async def fail_generate_clinical_case(**_kwargs) -> ClinicalCaseCreate:
        raise AssertionError("Unsupported generation parameters must not reach provider")

    monkeypatch.setattr(
        cases_router,
        "generate_clinical_case",
        fail_generate_clinical_case,
    )

    specialty_response = await client.post(
        "/api/cases/generate",
        headers=auth_headers,
        json={
            "specialty": "oncology",
            "difficulty": "medium",
            "acknowledge_unreviewed_generation": True,
        },
    )
    difficulty_response = await client.post(
        "/api/cases/generate",
        headers=auth_headers,
        json={
            "specialty": "internal_medicine",
            "difficulty": "critical",
            "acknowledge_unreviewed_generation": True,
        },
    )

    assert specialty_response.status_code == 422
    assert difficulty_response.status_code == 422
    after_count = await db.scalar(select(func.count()).select_from(ClinicalCase))
    assert after_count == before_count


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


async def test_dynamic_generation_quality_gate_blocks_storage(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch,
):
    auth_headers = await _register_and_login(client)
    before_count = await db.scalar(select(func.count()).select_from(ClinicalCase))

    async def fake_generate_clinical_case(**_kwargs) -> ClinicalCaseCreate:
        raw_case = copy.deepcopy(CASE_POOL[0])
        raw_case["clinical_red_flags"] = []
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

    assert response.status_code == 422
    assert "Generated case blocked by case quality gate" in response.json()["detail"]
    assert "clinical red flags" in response.json()["detail"]
    after_count = await db.scalar(select(func.count()).select_from(ClinicalCase))
    assert after_count == before_count


async def test_demo_generation_quality_gate_blocks_storage(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch,
):
    auth_headers = await _register_and_login(client)
    before_count = await db.scalar(select(func.count()).select_from(ClinicalCase))

    async def fake_generate_demo_case() -> ClinicalCaseCreate:
        raw_case = copy.deepcopy(CASE_POOL[0])
        raw_case["physical_exam"]["vitals"]["bp"] = "normal"
        return ClinicalCaseCreate(**raw_case)

    monkeypatch.setattr(
        cases_router,
        "generate_demo_case",
        fake_generate_demo_case,
    )

    response = await client.post("/api/cases/generate/demo", headers=auth_headers)

    assert response.status_code == 422
    assert "Generated case blocked by case quality gate" in response.json()["detail"]
    assert "vitals.bp" in response.json()["detail"]
    after_count = await db.scalar(select(func.count()).select_from(ClinicalCase))
    assert after_count == before_count


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
    assert provenance["review_content_changed"] is False
    assert provenance["last_reviewed_at"] == "2024-01-01"
    assert provenance["review_valid_until"] == "2024-12-31"


async def test_future_clinician_review_provenance_requires_caution(
    client: AsyncClient,
    db: AsyncSession,
):
    auth_headers = await _register_and_login(client)
    case_payload = dict(CASE_POOL[0])
    case_payload["review_status"] = "clinician_reviewed"
    case_payload["last_reviewed_at"] = "2099-01-01"
    case = ClinicalCase(**case_payload)
    db.add(case)
    await db.commit()
    await db.refresh(case)

    response = await client.get(f"/api/cases/{case.id}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    provenance = payload["source_provenance"]
    assert provenance["review_status"] == "clinician_reviewed"
    assert provenance["review_label"] == "Clinician review date invalid"
    assert provenance["requires_caution"] is True
    assert provenance["review_date_invalid"] is True
    assert provenance["review_stale"] is False
    assert provenance["review_content_changed"] is False
    assert provenance["last_reviewed_at"] == "2099-01-01"
    assert provenance["review_valid_until"] is None


async def test_missing_clinician_review_audit_provenance_requires_caution(
    client: AsyncClient,
    db: AsyncSession,
):
    auth_headers = await _register_and_login(client)
    case_payload = dict(CASE_POOL[0])
    case_payload["review_status"] = "clinician_reviewed"
    case_payload["last_reviewed_at"] = date.today().isoformat()
    case = ClinicalCase(**case_payload)
    db.add(case)
    await db.commit()
    await db.refresh(case)

    response = await client.get(f"/api/cases/{case.id}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    provenance = payload["source_provenance"]
    assert provenance["review_status"] == "clinician_reviewed"
    assert provenance["review_label"] == "Clinician review audit missing"
    assert provenance["requires_caution"] is True
    assert provenance["review_audit_missing"] is True
    assert provenance["review_stale"] is False
    assert provenance["review_date_invalid"] is False
    assert provenance["review_content_changed"] is False


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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
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
    assert history[0]["source_snapshot"]["case_content_fingerprint"]
    assert history[0]["source_snapshot"]["alignment_checklist"] == SOURCE_ALIGNMENT_CHECKS
    assert history[0]["source_snapshot"]["supported_elements"][0]["supports"]


async def test_clinical_review_requires_source_alignment_checklist(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"alignment-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Alignment Reviewer",
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
            "source_alignment_checks": {
                **SOURCE_ALIGNMENT_CHECKS,
                "contraindication_checks_supported": False,
            },
            "educational_safety_confirmed": True,
            "review_notes": "Trying to approve partial source alignment.",
        },
    )

    assert response.status_code == 422
    assert "Source alignment confirmation requires all source alignment checks" in str(
        response.json()["detail"]
    )


async def test_clinical_review_requires_audit_review_notes(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"notes-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Notes Reviewer",
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": "OK",
        },
    )

    assert response.status_code == 422
    assert "Clinical review notes must summarize source alignment" in str(
        response.json()["detail"]
    )


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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
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


async def test_clinical_review_requires_pregnancy_safety_check_for_reproductive_age_female(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"pregnancy-safety-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Pregnancy Safety Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case_payload = dict(CASE_POOL[0])
    case_payload["patient_demographics"] = {
        "age": 32,
        "sex": "female",
        "weight_kg": 64,
        "ethnicity": "Korean",
    }
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": (
                "Trying to approve source-aligned case without pregnancy safety review."
            ),
        },
    )

    assert response.status_code == 409
    assert "case quality gate" in response.json()["detail"]
    assert "pregnancy status safety check is required" in response.json()["detail"]
    await db.refresh(case)
    assert case.review_status == case_payload["review_status"]
    assert case.reviewed_by_user_id is None


async def test_clinical_review_requires_weight_based_safety_check_for_pediatric_case(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"pediatric-safety-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Pediatric Safety Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case_payload = dict(CASE_POOL[0])
    case_payload["patient_demographics"] = {
        "age": 8,
        "sex": "male",
        "weight_kg": 28,
        "ethnicity": "Korean",
    }
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": (
                "Trying to approve pediatric case without weight-based safety review."
            ),
        },
    )

    assert response.status_code == 409
    assert "case quality gate" in response.json()["detail"]
    assert "weight-based dosing safety check is required" in response.json()["detail"]
    await db.refresh(case)
    assert case.review_status == case_payload["review_status"]
    assert case.reviewed_by_user_id is None


async def test_clinical_review_requires_renal_safety_check_for_contrast_imaging(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"renal-safety-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Renal Safety Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case_payload = dict(CASE_POOL[0])
    case_payload["time_critical_actions"] = [
        "Obtain CT pulmonary angiography promptly when pulmonary embolism remains high risk",
        "Escalate anticoagulation pathway planning after dangerous alternatives are addressed",
    ]
    case_payload["contraindication_checks"] = [
        "Contrast allergy before CT pulmonary angiography",
        "Active bleeding risk before anticoagulation",
    ]
    case_payload["clinical_sources"] = [
        {
            "title": "ESC Guidelines for Pulmonary Embolism",
            "organization": "European Society of Cardiology",
            "url": "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines",
            "supports": [
                "pulmonary embolism diagnosis and risk stratification pathway",
                "life-threatening chest pain differential and severity markers",
                "CT pulmonary angiography timing for high-risk suspected pulmonary embolism",
                "anticoagulation pathway escalation when dangerous alternatives are addressed",
                "crushing substernal chest pain radiating to the arm with diaphoresis",
                "bibasilar crackles suggesting early heart failure",
                "tachycardia with multiple coronary risk factors",
                "contrast allergy before CT pulmonary angiography",
                "active bleeding risk before anticoagulation",
            ],
        }
    ]
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": (
                "Trying to approve contrast imaging case without renal function review."
            ),
        },
    )

    assert response.status_code == 409
    assert "case quality gate" in response.json()["detail"]
    assert "renal function safety check is required" in response.json()["detail"]
    await db.refresh(case)
    assert case.review_status == case_payload["review_status"]
    assert case.reviewed_by_user_id is None


async def test_clinical_review_requires_bleeding_safety_check_for_thrombolysis(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"bleeding-safety-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Bleeding Safety Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case_payload = copy.deepcopy(CASE_POOL[0])
    case_payload["time_critical_actions"] = [
        "Start thrombolysis pathway immediately when criteria are met",
        "Activate reperfusion pathway for high-risk presentation",
    ]
    case_payload["contraindication_checks"] = [
        "Pregnancy status before thrombolysis",
        "Renal function before contrast imaging",
    ]
    case_payload["clinical_sources"] = [
        {
            "title": "2021 AHA/ACC Guideline for the Evaluation and Diagnosis of Chest Pain",
            "organization": "American Heart Association / American College of Cardiology",
            "url": "https://www.jacc.org/doi/10.1016/j.jacc.2021.07.052",
            "supports": [
                "ACS diagnosis and risk stratification for acute chest pain",
                "life-threatening chest pain differential and severity markers",
                "thrombolysis pathway activation and reperfusion timing for high-risk presentation",
                "crushing substernal chest pain radiating to the arm with diaphoresis",
                "bibasilar crackles suggesting early heart failure",
                "tachycardia with multiple coronary risk factors",
                "pregnancy status before thrombolysis",
                "renal function before contrast imaging",
            ],
        }
    ]
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": (
                "Trying to approve thrombolysis case without bleeding risk review."
            ),
        },
    )

    assert response.status_code == 409
    assert "case quality gate" in response.json()["detail"]
    assert "bleeding risk safety check is required" in response.json()["detail"]
    await db.refresh(case)
    assert case.review_status == case_payload["review_status"]
    assert case.reviewed_by_user_id is None


async def test_clinical_review_requires_antimicrobial_safety_for_sepsis_therapy(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"antimicrobial-safety-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Antimicrobial Safety Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case_payload = copy.deepcopy(CASE_POOL[1])
    case_payload["contraindication_checks"] = [
        "Volume overload risk during fluid resuscitation in CKD or heart failure",
        "Need for vasopressors if hypotension persists after initial resuscitation",
    ]
    case_payload["clinical_sources"] = [
        {
            "title": "Surviving Sepsis Campaign Adult Guidelines",
            "organization": "Society of Critical Care Medicine",
            "url": "https://www.sccm.org/survivingsepsiscampaign/guidelines-and-resources/surviving-sepsis-campaign-adult-guidelines",
            "supports": [
                "lactate measurement and reassessment",
                "hypotension, fever, and altered mental status as sepsis severity markers",
                "lactate elevation and tissue hypoperfusion in septic shock",
                "AKI, thrombocytopenia, delayed urination, and poor perfusion as organ dysfunction",
                "suspected septic shock recognition and immediate escalation",
                "blood cultures and antimicrobial timing",
                "fluid reassessment and vasopressor escalation",
                "shock severity markers and organ dysfunction in sepsis diagnosis",
                "hypotension with fever and altered mental status",
                "lactate 4.1 mmol/L suggesting tissue hypoperfusion",
                "AKI, thrombocytopenia, delayed urination, and poor perfusion",
                "obtain blood cultures promptly without delaying empiric antibiotics",
                "start sepsis bundle actions including fluids, antibiotics, lactate reassessment, and source control planning",
                "volume overload risk during fluid resuscitation in CKD or heart failure",
                "need for vasopressors if hypotension persists after initial resuscitation",
            ],
        }
    ]
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": (
                "Trying to approve sepsis therapy without antimicrobial safety review."
            ),
        },
    )

    assert response.status_code == 409
    assert "case quality gate" in response.json()["detail"]
    assert "antimicrobial allergy and renal dosing safety checks" in response.json()["detail"]
    await db.refresh(case)
    assert case.review_status == case_payload["review_status"]
    assert case.reviewed_by_user_id is None


async def test_clinical_review_requires_dka_insulin_safety_checks(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"dka-safety-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="DKA Safety Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case_payload = copy.deepcopy(CASE_POOL[3])
    case_payload["contraindication_checks"] = [
        "Need to exclude surgical abdomen if pain persists after metabolic correction",
        "Assess infection trigger before DKA protocol",
    ]
    case_payload["clinical_sources"] = [
        {
            "title": "Standards of Care in Diabetes",
            "organization": "American Diabetes Association",
            "url": "https://professional.diabetes.org/standards-of-care",
            "supports": [
                "DKA diagnostic pattern",
                "acidosis, dehydration, and mental status severity markers",
                "severe metabolic acidosis with Kussmaul respirations",
                "tachycardia, dehydration signs, AKI, and confusion in DKA severity assessment",
                "hyperkalemia despite total body potassium depletion",
                "potassium assessment before insulin therapy",
                "time-critical monitored DKA protocol with fluids, insulin planning, and anion-gap closure",
                "need to exclude surgical abdomen if pain persists after metabolic correction",
                "assess infection trigger before DKA protocol",
            ],
        }
    ]
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": (
                "Trying to approve DKA therapy without potassium/osmolar safety review."
            ),
        },
    )

    assert response.status_code == 409
    assert "case quality gate" in response.json()["detail"]
    assert "DKA safety checks must include potassium threshold" in response.json()["detail"]
    await db.refresh(case)
    assert case.review_status == case_payload["review_status"]
    assert case.reviewed_by_user_id is None


async def test_clinical_review_requires_stroke_reperfusion_safety_checks(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"stroke-safety-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Stroke Safety Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case_payload = copy.deepcopy(CASE_POOL[4])
    case_payload["contraindication_checks"] = [
        "Intracranial hemorrhage or early extensive ischemic change on imaging",
        "Large vessel occlusion criteria and transfer needs for thrombectomy",
        "Recent bleeding history before thrombolysis",
    ]
    case_payload["clinical_sources"] = [
        {
            "title": "AHA/ASA Acute Ischemic Stroke Guidelines",
            "organization": "American Heart Association / American Stroke Association",
            "url": "https://www.heart.org/en/professional/quality-improvement/get-with-the-guidelines/get-with-the-guidelines-stroke",
            "supports": [
                "last-known-normal based reperfusion eligibility",
                "sudden focal neurologic deficit and NIHSS severity assessment",
                "potentially treatable stroke within thrombolysis window from last known normal",
                "atrial fibrillation with missed anticoagulation suggesting embolic risk",
                "noncontrast head CT to exclude hemorrhage before treatment decision",
                "establish last known normal and activate stroke pathway immediately",
                "assess thrombolysis and thrombectomy eligibility in parallel",
                "intracranial hemorrhage or early extensive ischemic change on imaging",
                "large vessel occlusion criteria and transfer needs for thrombectomy",
                "recent bleeding history before thrombolysis",
            ],
        }
    ]
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": (
                "Trying to approve stroke reperfusion without threshold safety review."
            ),
        },
    )

    assert response.status_code == 409
    assert "case quality gate" in response.json()["detail"]
    assert "stroke reperfusion safety checks" in response.json()["detail"]
    await db.refresh(case)
    assert case.review_status == case_payload["review_status"]
    assert case.reviewed_by_user_id is None


async def test_clinical_review_requires_pe_risk_and_safety_checks(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"pe-safety-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="PE Safety Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case_payload = copy.deepcopy(CASE_POOL[2])
    case_payload["contraindication_checks"] = [
        "Bleeding risk and recent surgery before thrombolysis or anticoagulation",
        "Contrast allergy before CT pulmonary angiography",
        "Need for escalation if hypotension persists",
    ]
    case_payload["clinical_sources"] = [
        {
            "title": "2019 ESC Guidelines for Acute Pulmonary Embolism",
            "organization": "European Society of Cardiology",
            "url": "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-Pulmonary-Embolism-Diagnosis-and-Management-of",
            "supports": [
                "risk stratification by hemodynamic instability and RV strain",
                "sudden dyspnea, hypoxemia, pleuritic chest pain, and recent surgery in PE assessment",
                "tachycardia, borderline blood pressure, and right heart strain as PE severity markers",
                "unilateral calf swelling and elevated D-dimer in suspected PE",
                "massive versus submassive PE risk stratification before disposition",
                "urgent escalation for worsening hypotension, syncope, or shock",
                "imaging, bedside echo, and hemodynamic stability pathways",
                "bleeding risk and recent surgery before thrombolysis or anticoagulation",
                "contrast allergy before CT pulmonary angiography",
                "need for escalation if hypotension persists",
            ],
        }
    ]
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": (
                "Trying to approve PE case without renal or pregnancy safety review."
            ),
        },
    )

    assert response.status_code == 409
    assert "case quality gate" in response.json()["detail"]
    assert "PE safety checks must include bleeding or recent-surgery risk" in response.json()["detail"]
    await db.refresh(case)
    assert case.review_status == case_payload["review_status"]
    assert case.reviewed_by_user_id is None


async def test_clinical_review_rejects_placeholder_source_url(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"source-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Source Reviewer",
        training_level="fellow",
        role="clinician_reviewer",
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )
    case_payload = dict(CASE_POOL[0])
    case_payload["clinical_sources"] = [
        {
            "title": "Placeholder Guideline",
            "organization": "Placeholder Society",
            "url": "https://example.org/guideline",
            "supports": ["diagnosis", "safety checks"],
        }
    ]
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": "Trying to approve placeholder evidence.",
        },
    )

    assert response.status_code == 409
    assert "case quality gate" in response.json()["detail"]
    assert "placeholder source domain" in response.json()["detail"]
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
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": (
                "Sources, hidden safety checks, and simulation limitations reviewed."
            ),
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
    assert (
        review.review_notes
        == "Sources, hidden safety checks, and simulation limitations reviewed."
    )
    assert review.source_snapshot["source_count"] == 1
    assert review.source_snapshot["case_content_fingerprint"]
    assert review.source_snapshot["alignment_checklist"] == SOURCE_ALIGNMENT_CHECKS
    assert review.source_snapshot["supported_elements"][0]["title"]


async def test_post_review_case_content_change_blocks_sessions_until_re_review(
    client: AsyncClient,
    db: AsyncSession,
):
    reviewer = User(
        email=f"content-change-reviewer-{uuid.uuid4()}@test.com",
        hashed_password=hash_password("reviewpass123"),
        full_name="Content Change Reviewer",
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

    review_response = await client.post(
        f"/api/cases/{case.id}/clinical-review",
        headers=reviewer_headers,
        json={
            "clinical_accuracy_confirmed": True,
            "source_alignment_confirmed": True,
            "source_alignment_checks": SOURCE_ALIGNMENT_CHECKS,
            "educational_safety_confirmed": True,
            "review_notes": "Baseline source and safety review before content change.",
        },
    )
    assert review_response.status_code == 200
    assert review_response.json()["source_provenance"]["requires_caution"] is False

    await db.refresh(case)
    case.key_teaching_points = [
        *case.key_teaching_points,
        "Post-review teaching point that was not clinician reviewed.",
    ]
    await db.commit()

    case_response = await client.get(f"/api/cases/{case.id}", headers=reviewer_headers)

    assert case_response.status_code == 200
    provenance = case_response.json()["source_provenance"]
    assert provenance["review_status"] == "clinician_reviewed"
    assert provenance["review_label"] == "Clinician review content changed"
    assert provenance["requires_caution"] is True
    assert provenance["review_stale"] is False
    assert provenance["review_content_changed"] is True

    blocked_session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
        },
        headers=reviewer_headers,
    )
    assert blocked_session_response.status_code == 409
    assert "changed after clinician review" in blocked_session_response.json()["detail"]

    acknowledged_session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": str(case.id),
            "acknowledge_educational_simulation": True,
            "acknowledge_unreviewed_case": True,
        },
        headers=reviewer_headers,
    )
    assert acknowledged_session_response.status_code == 409
    assert "changed after clinician review" in acknowledged_session_response.json()["detail"]
    await db.refresh(case)
    assert case.times_used == 0
