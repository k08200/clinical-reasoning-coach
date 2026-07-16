from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.utils.auth import create_access_token, hash_password


def _user(*, email: str, role: str = "learner") -> User:
    return User(
        email=email,
        hashed_password=hash_password("release-workflow-pass123"),
        full_name=email.split("@")[0].replace("-", " ").title(),
        training_level="resident",
        role=role,
        accepted_educational_use=True,
        accepted_educational_use_at=datetime.now(timezone.utc),
    )


def _headers_for(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


async def test_verified_reviewer_can_release_a_reviewed_case_to_a_learner(
    client: AsyncClient,
    db: AsyncSession,
):
    """Exercise the complete human-review workflow without bypassing its API gates."""
    suffix = uuid.uuid4()
    admin = _user(email=f"release-admin-{suffix}@test.com", role="admin")
    reviewer = _user(email=f"release-reviewer-{suffix}@test.com")
    learner = _user(email=f"release-learner-{suffix}@test.com")
    db.add_all([admin, reviewer, learner])
    await db.commit()
    await db.refresh(admin)
    await db.refresh(reviewer)
    await db.refresh(learner)

    promote_response = await client.patch(
        f"/api/auth/users/{reviewer.id}/role",
        json={"role": "clinician_reviewer"},
        headers=_headers_for(admin),
    )
    assert promote_response.status_code == 200
    assert promote_response.json()["reviewer_verification_status"] == "pending"

    verify_response = await client.patch(
        f"/api/auth/users/{reviewer.id}/reviewer-verification",
        json={
            "status": "verified",
            "practice_scope": "Emergency medicine educational simulation",
            "verification_note": "Verified current education-review credentials.",
        },
        headers=_headers_for(admin),
    )
    assert verify_response.status_code == 200
    assert verify_response.json()["reviewer_credential_current"] is True

    generate_response = await client.post(
        "/api/cases/generate/demo",
        headers=_headers_for(learner),
    )
    assert generate_response.status_code == 201
    case_id = generate_response.json()["id"]

    review_detail_response = await client.get(
        f"/api/cases/{case_id}/clinical-review/detail",
        headers=_headers_for(reviewer),
    )
    assert review_detail_response.status_code == 200
    review_detail = review_detail_response.json()

    review_response = await client.post(
        f"/api/cases/{case_id}/clinical-review",
        json={
            "clinical_accuracy_confirmed": True,
            "source_alignment_confirmed": True,
            "educational_safety_confirmed": True,
            "source_alignment_checks": {
                "teaching_points_supported": True,
                "red_flags_supported": True,
                "time_critical_actions_supported": True,
                "contraindication_checks_supported": True,
            },
            "reviewer_attestation": {
                "practice_scope": "Emergency medicine educational simulation",
                "attests_review_within_scope": True,
                "attests_educational_use_only": True,
            },
            "source_evidence_attestation": {
                "source_urls": [
                    source["url"] for source in review_detail["clinical_sources"]
                ],
                "verified_on": date.today().isoformat(),
                "attests_sources_accessed": True,
                "attests_sources_current": True,
            },
            "review_notes": (
                "Source alignment, safety checks, and educational simulation "
                "limitations reviewed for this training case."
            ),
        },
        headers=_headers_for(reviewer),
    )
    assert review_response.status_code == 200

    learner_case_response = await client.get(
        f"/api/cases/{case_id}",
        headers=_headers_for(learner),
    )
    assert learner_case_response.status_code == 200
    provenance = learner_case_response.json()["source_provenance"]
    assert provenance["review_status"] == "clinician_reviewed"
    assert provenance["requires_caution"] is False
    assert provenance["source_evidence_attestation_incomplete"] is False

    session_response = await client.post(
        "/api/sessions",
        json={
            "case_id": case_id,
            "acknowledge_educational_simulation": True,
        },
        headers=_headers_for(learner),
    )
    assert session_response.status_code == 201
    assert session_response.json()["status"] == "active"
