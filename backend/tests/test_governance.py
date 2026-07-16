from __future__ import annotations

import copy
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.case import ClinicalCase
from app.config import get_settings
from app.models.safety_event import SafetyEvent
from app.models.session import CoachingSession
from app.models.user import LEGACY_EDUCATIONAL_USE_CONSENT_VERSION, User
from app.config import Settings
from app.routers import governance as governance_router
from app.services.mock_provider import CASE_POOL
from app.services.provider import ProviderReadiness
from app.utils.auth import create_access_token, hash_password


def _headers_for(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def _user(*, email: str, role: str = "learner", verification_status: str = "not_applicable") -> User:
    return User(
        email=email,
        hashed_password=hash_password("governancepass123"),
        full_name=email.split("@")[0].replace("-", " ").title(),
        training_level="resident",
        role=role,
        reviewer_verification_status=verification_status,
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_governance_readiness_summarizes_release_blockers(
    client: AsyncClient,
    db: AsyncSession,
):
    admin = _user(email="governance-admin@test.com", role="admin")
    db.add(admin)
    await db.commit()
    await db.refresh(admin)
    baseline_response = await client.get("/api/governance/readiness", headers=_headers_for(admin))
    assert baseline_response.status_code == 200
    baseline = baseline_response.json()

    learner = _user(email="governance-learner@test.com")
    learner.accepted_educational_use_version = LEGACY_EDUCATIONAL_USE_CONSENT_VERSION
    pending_reviewer = _user(
        email="governance-pending@test.com",
        role="clinician_reviewer",
        verification_status="pending",
    )
    suspended_reviewer = _user(
        email="governance-suspended@test.com",
        role="clinician_reviewer",
        verification_status="suspended",
    )
    draft_payload = copy.deepcopy(CASE_POOL[0])
    draft_payload["review_status"] = "educational_draft"
    draft_payload["last_reviewed_at"] = None
    draft_case = ClinicalCase(**draft_payload)
    db.add_all([learner, pending_reviewer, suspended_reviewer, draft_case])
    await db.commit()
    await db.refresh(draft_case)

    session = CoachingSession(user_id=learner.id, case_id=draft_case.id, status="safety_locked")
    db.add(session)
    await db.commit()
    await db.refresh(session)
    db.add(
        SafetyEvent(
            session_id=session.id,
            user_id=learner.id,
            event_type="possible_patient_identifier",
            severity="high",
            action_taken="session_locked",
            detected_terms=["name"],
            message_turn=1,
            note="Potential patient identifier detected.",
            status="open",
        )
    )
    await db.commit()

    response = await client.get("/api/governance/readiness", headers=_headers_for(admin))

    assert response.status_code == 200
    body = response.json()
    assert body["learner_eligible_case_count"] == baseline["learner_eligible_case_count"]
    assert body["case_blocker_count"] == baseline["case_blocker_count"] + 1
    draft_blocker = next(
        blocker for blocker in body["case_blockers"] if blocker["case_id"] == str(draft_case.id)
    )
    assert "Clinician review required" in draft_blocker["reasons"]
    assert body["open_safety_event_count"] == baseline["open_safety_event_count"] + 1
    assert body["open_high_risk_safety_event_count"] == baseline["open_high_risk_safety_event_count"] + 1
    assert body["verified_clinician_reviewer_count"] == baseline["verified_clinician_reviewer_count"]
    assert body["pending_clinician_reviewer_count"] == baseline["pending_clinician_reviewer_count"] + 1
    assert body["suspended_clinician_reviewer_count"] == baseline["suspended_clinician_reviewer_count"] + 1
    assert body["consent_renewal_required_user_count"] == baseline["consent_renewal_required_user_count"] + 1
    assert body["release_ready"] is False
    assert "open_high_risk_safety_events" in {
        blocker["code"] for blocker in body["release_blockers"]
    }

    await db.execute(delete(SafetyEvent).where(SafetyEvent.session_id == session.id))
    await db.execute(delete(CoachingSession).where(CoachingSession.id == session.id))
    await db.execute(delete(ClinicalCase).where(ClinicalCase.id == draft_case.id))
    await db.execute(
        delete(User).where(
            User.id.in_([admin.id, learner.id, pending_reviewer.id, suspended_reviewer.id])
        )
    )
    await db.commit()


@pytest.mark.asyncio
async def test_governance_readiness_requires_admin(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = _user(email=f"governance-learner-{uuid.uuid4()}@test.com")
    db.add(learner)
    await db.commit()
    await db.refresh(learner)

    response = await client.get("/api/governance/readiness", headers=_headers_for(learner))

    assert response.status_code == 403
    assert response.json()["detail"] == "Admin role required"

    await db.delete(learner)
    await db.commit()


@pytest.mark.asyncio
async def test_governance_readiness_blocks_production_release_when_provider_is_not_ready(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    admin = _user(email=f"governance-model-admin-{uuid.uuid4()}@test.com", role="admin")
    db.add(admin)
    await db.commit()
    await db.refresh(admin)
    monkeypatch.setattr(
        governance_router,
        "get_settings",
        lambda: Settings(
            app_environment="production",
            secret_key="replace-with-a-long-random-secret",
            database_auto_create_tables=False,
            llm_provider="ollama",
            rate_limit_enabled=True,
            clinical_review_minimum_distinct_reviewers=2,
            model_release_approval_id="clinical-eval-2026-07-001",
            model_release_approval_provider="ollama",
            model_release_approval_model="llama3.2",
            model_release_approval_expires_on=date.today() + timedelta(days=90),
        ),
    )

    async def unavailable_provider() -> ProviderReadiness:
        return ProviderReadiness(
            ready=False,
            verification="unavailable",
            detail="Configured provider is unavailable.",
        )

    monkeypatch.setattr(
        governance_router,
        "get_provider_readiness",
        unavailable_provider,
    )

    response = await client.get("/api/governance/readiness", headers=_headers_for(admin))

    assert response.status_code == 200
    body = response.json()
    assert body["provider_ready"] is False
    assert body["provider_detail"] == "Configured provider is unavailable."
    assert body["model_release_approval_current"] is True
    assert {
        blocker["code"] for blocker in body["release_blockers"]
    } >= {"clinical_coaching_provider_not_ready"}
    assert body["release_ready"] is False

    await db.delete(admin)
    await db.commit()


@pytest.mark.asyncio
async def test_governance_readiness_counts_expired_reviewer_credentials(
    client: AsyncClient,
    db: AsyncSession,
):
    admin = _user(email=f"governance-expiry-admin-{uuid.uuid4()}@test.com", role="admin")
    current_reviewer = _user(
        email=f"governance-current-reviewer-{uuid.uuid4()}@test.com",
        role="clinician_reviewer",
        verification_status="verified",
    )
    current_reviewer.reviewer_practice_scope = "Emergency medicine educational simulation"
    current_reviewer.reviewer_verified_at = datetime.now(timezone.utc)
    current_reviewer.reviewer_verified_by_user_id = uuid.uuid4()
    expired_reviewer = _user(
        email=f"governance-expired-reviewer-{uuid.uuid4()}@test.com",
        role="clinician_reviewer",
        verification_status="verified",
    )
    expired_reviewer.reviewer_practice_scope = "Emergency medicine educational simulation"
    expired_reviewer.reviewer_verified_at = datetime.now(timezone.utc) - timedelta(
        days=get_settings().reviewer_credential_valid_days + 1
    )
    expired_reviewer.reviewer_verified_by_user_id = uuid.uuid4()
    db.add_all([admin, current_reviewer, expired_reviewer])
    await db.commit()
    await db.refresh(admin)

    response = await client.get("/api/governance/readiness", headers=_headers_for(admin))

    assert response.status_code == 200
    body = response.json()
    assert body["verified_clinician_reviewer_count"] >= 1
    assert body["expired_clinician_reviewer_count"] >= 1

    await db.execute(
        delete(User).where(User.id.in_([admin.id, current_reviewer.id, expired_reviewer.id]))
    )
    await db.commit()
