from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.user import User
from app.utils.auth import create_access_token, create_refresh_token, hash_password


async def create_user(
    db: AsyncSession,
    *,
    email: str,
    role: str = "learner",
    accepted_educational_use: bool = True,
) -> User:
    user = User(
        email=email,
        hashed_password=hash_password("securepass123"),
        full_name=email.split("@")[0].replace("-", " ").title(),
        training_level="resident",
        role=role,
        accepted_educational_use=accepted_educational_use,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def headers_for(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


@pytest.mark.asyncio
async def test_register_success(client: AsyncClient):
    response = await client.post("/api/auth/register", json={
        "email": "new@test.com",
        "password": "securepass123",
        "full_name": "New User",
        "training_level": "resident",
        "accepted_educational_use": True,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "new@test.com"
    assert data["training_level"] == "resident"
    assert data["role"] == "learner"
    assert data["accepted_educational_use"] is True
    assert data["accepted_educational_use_at"]
    assert "id" in data
    assert "hashed_password" not in data


@pytest.mark.asyncio
async def test_register_requires_educational_use_consent(client: AsyncClient):
    response = await client.post("/api/auth/register", json={
        "email": "no-consent@test.com",
        "password": "securepass123",
        "full_name": "No Consent User",
        "training_level": "resident",
    })

    assert response.status_code == 422
    assert "educational simulation only" in response.text

    false_response = await client.post("/api/auth/register", json={
        "email": "false-consent@test.com",
        "password": "securepass123",
        "full_name": "False Consent User",
        "training_level": "resident",
        "accepted_educational_use": False,
    })

    assert false_response.status_code == 422


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    payload = {
        "email": "dup@test.com",
        "password": "pass12345",
        "full_name": "Dup User",
        "accepted_educational_use": True,
    }
    r1 = await client.post("/api/auth/register", json=payload)
    assert r1.status_code == 201
    r2 = await client.post("/api/auth/register", json=payload)
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_register_weak_password(client: AsyncClient):
    response = await client.post("/api/auth/register", json={
        "email": "weak@test.com",
        "password": "short",
        "full_name": "Weak User",
        "accepted_educational_use": True,
    })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    # Register first
    await client.post("/api/auth/register", json={
        "email": "login@test.com",
        "password": "loginpass123",
        "full_name": "Login User",
        "accepted_educational_use": True,
    })
    # Login
    response = await client.post("/api/auth/token", data={
        "username": "login@test.com",
        "password": "loginpass123",
    })
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_refresh_token_success(client: AsyncClient):
    await client.post("/api/auth/register", json={
        "email": "refresh@test.com",
        "password": "refreshpass123",
        "full_name": "Refresh User",
        "accepted_educational_use": True,
    })
    login_response = await client.post("/api/auth/token", data={
        "username": "refresh@test.com",
        "password": "refreshpass123",
    })

    response = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": login_response.json()["refresh_token"]},
    )

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_refresh_rejects_access_token(client: AsyncClient):
    access_token = create_access_token({"sub": str(uuid.uuid4())})

    response = await client.post(
        "/api/auth/refresh",
        json={"refresh_token": access_token},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_cannot_access_me(client: AsyncClient):
    refresh_token = create_refresh_token({"sub": str(uuid.uuid4())})

    response = await client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {refresh_token}"},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_existing_user_can_accept_educational_use_consent(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email="legacy@test.com",
        hashed_password=hash_password("legacypass123"),
        full_name="Legacy User",
        training_level="resident",
        accepted_educational_use=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    me_response = await client.get("/api/auth/me", headers=headers)
    assert me_response.status_code == 200
    assert me_response.json()["accepted_educational_use"] is False

    blocked_response = await client.get("/api/cases", headers=headers)
    assert blocked_response.status_code == 403
    assert blocked_response.json()["detail"] == "Educational use consent required"

    consent_response = await client.post(
        "/api/auth/educational-use-consent",
        json={"accepted_educational_use": True},
        headers=headers,
    )

    assert consent_response.status_code == 200
    payload = consent_response.json()
    assert payload["accepted_educational_use"] is True
    assert payload["accepted_educational_use_at"]

    allowed_response = await client.get("/api/cases", headers=headers)
    assert allowed_response.status_code == 200


@pytest.mark.asyncio
async def test_educational_use_consent_requires_true(
    client: AsyncClient,
    db: AsyncSession,
):
    user = User(
        email="reject-consent@test.com",
        hashed_password=hash_password("rejectpass123"),
        full_name="Reject Consent",
        training_level="resident",
        accepted_educational_use=False,
        accepted_educational_use_at=None,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}",
    }

    response = await client.post(
        "/api/auth/educational-use-consent",
        json={"accepted_educational_use": False},
        headers=headers,
    )

    assert response.status_code == 422
    assert "educational simulation only" in response.text


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    await client.post("/api/auth/register", json={
        "email": "wrongpass@test.com",
        "password": "correctpass123",
        "full_name": "Wrong User",
        "accepted_educational_use": True,
    })
    response = await client.post("/api/auth/token", data={
        "username": "wrongpass@test.com",
        "password": "wrongpassword",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_me(client: AsyncClient, auth_headers: dict):
    response = await client.get("/api/auth/me", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "student@test.com"
    assert data["role"] == "learner"


@pytest.mark.asyncio
async def test_get_me_no_token(client: AsyncClient):
    response = await client.get("/api/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_admin_bootstrap_requires_configured_token(
    client: AsyncClient,
    db: AsyncSession,
):
    get_settings.cache_clear()
    learner = await create_user(db, email="bootstrap-disabled@test.com")

    response = await client.post(
        "/api/auth/admin/bootstrap",
        json={"setup_token": "anything"},
        headers=headers_for(learner),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Admin bootstrap is not configured"


@pytest.mark.asyncio
async def test_admin_bootstrap_rejects_invalid_token(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("ADMIN_BOOTSTRAP_TOKEN", "correct-bootstrap-token")
    get_settings.cache_clear()
    learner = await create_user(db, email="bootstrap-invalid@test.com")

    response = await client.post(
        "/api/auth/admin/bootstrap",
        json={"setup_token": "wrong-token"},
        headers=headers_for(learner),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid admin bootstrap token"
    assert (await client.get("/api/auth/me", headers=headers_for(learner))).json()["role"] == "learner"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_admin_bootstrap_promotes_first_admin(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("ADMIN_BOOTSTRAP_TOKEN", "first-admin-token")
    get_settings.cache_clear()
    learner = await create_user(db, email="bootstrap-first@test.com")

    response = await client.post(
        "/api/auth/admin/bootstrap",
        json={"setup_token": "first-admin-token"},
        headers=headers_for(learner),
    )

    assert response.status_code == 200
    assert response.json()["role"] == "admin"

    users_response = await client.get("/api/auth/users", headers=headers_for(learner))
    assert users_response.status_code == 200
    assert any(user["email"] == "bootstrap-first@test.com" for user in users_response.json())
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_admin_bootstrap_closes_after_admin_exists(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("ADMIN_BOOTSTRAP_TOKEN", "first-admin-token")
    get_settings.cache_clear()
    admin = await create_user(db, email="existing-admin@test.com", role="admin")
    learner = await create_user(db, email="bootstrap-second@test.com")

    response = await client.post(
        "/api/auth/admin/bootstrap",
        json={"setup_token": "first-admin-token"},
        headers=headers_for(learner),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Admin user already exists"
    assert (await client.get("/api/auth/me", headers=headers_for(learner))).json()["role"] == "learner"
    assert (await client.get("/api/auth/me", headers=headers_for(admin))).json()["role"] == "admin"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_learner_cannot_list_users(
    client: AsyncClient,
    db: AsyncSession,
):
    learner = await create_user(db, email="list-blocked-learner@test.com")

    response = await client.get("/api/auth/users", headers=headers_for(learner))

    assert response.status_code == 403
    assert response.json()["detail"] == "Admin role required"


@pytest.mark.asyncio
async def test_admin_can_list_users(
    client: AsyncClient,
    db: AsyncSession,
):
    admin = await create_user(db, email="admin-list@test.com", role="admin")
    learner = await create_user(db, email="learner-list@test.com")

    response = await client.get("/api/auth/users", headers=headers_for(admin))

    assert response.status_code == 200
    emails = {user["email"] for user in response.json()}
    assert "admin-list@test.com" in emails
    assert "learner-list@test.com" in emails
    listed_learner = next(user for user in response.json() if user["id"] == str(learner.id))
    assert listed_learner["role"] == "learner"
    assert "hashed_password" not in listed_learner


@pytest.mark.asyncio
async def test_admin_can_promote_clinician_reviewer(
    client: AsyncClient,
    db: AsyncSession,
):
    admin = await create_user(db, email="admin-promote@test.com", role="admin")
    learner = await create_user(db, email="reviewer-promote@test.com")

    response = await client.patch(
        f"/api/auth/users/{learner.id}/role",
        json={"role": "clinician_reviewer"},
        headers=headers_for(admin),
    )

    assert response.status_code == 200
    assert response.json()["role"] == "clinician_reviewer"
    assert response.json()["reviewer_verification_status"] == "pending"

    me_response = await client.get("/api/auth/me", headers=headers_for(learner))
    assert me_response.status_code == 200
    assert me_response.json()["role"] == "clinician_reviewer"
    assert me_response.json()["reviewer_verification_status"] == "pending"


@pytest.mark.asyncio
async def test_admin_can_verify_and_suspend_a_clinician_reviewer(
    client: AsyncClient,
    db: AsyncSession,
):
    admin = await create_user(db, email="admin-verify@test.com", role="admin")
    reviewer = await create_user(
        db,
        email="reviewer-verify@test.com",
        role="clinician_reviewer",
    )
    reviewer.reviewer_verification_status = "pending"
    await db.commit()

    verified_response = await client.patch(
        f"/api/auth/users/{reviewer.id}/reviewer-verification",
        json={
            "status": "verified",
            "practice_scope": "Emergency medicine educational simulation",
            "verification_note": "Verified current educational review credentials.",
        },
        headers=headers_for(admin),
    )

    assert verified_response.status_code == 200
    verified = verified_response.json()
    assert verified["reviewer_verification_status"] == "verified"
    assert verified["reviewer_practice_scope"] == "Emergency medicine educational simulation"
    assert verified["reviewer_verified_at"]
    assert verified["reviewer_verified_by_user_id"] == str(admin.id)

    suspended_response = await client.patch(
        f"/api/auth/users/{reviewer.id}/reviewer-verification",
        json={
            "status": "suspended",
            "verification_note": "Suspended pending credential review.",
        },
        headers=headers_for(admin),
    )

    assert suspended_response.status_code == 200
    suspended = suspended_response.json()
    assert suspended["reviewer_verification_status"] == "suspended"
    assert suspended["reviewer_practice_scope"] is None
    assert suspended["reviewer_verified_at"] is None
    assert suspended["reviewer_verified_by_user_id"] is None

    history_response = await client.get(
        f"/api/auth/users/{reviewer.id}/reviewer-verification/history",
        headers=headers_for(admin),
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert [(event["action"], event["resulting_verification_status"]) for event in history] == [
        ("credentials_suspended", "suspended"),
        ("credentials_verified", "verified"),
    ]
    assert history[0]["verification_note"] == "Suspended pending credential review."
    assert history[0]["actioned_by_user_id"] == str(admin.id)


@pytest.mark.asyncio
async def test_admin_cannot_verify_own_clinician_credentials(
    client: AsyncClient,
    db: AsyncSession,
):
    admin = await create_user(db, email="self-verify-admin@test.com", role="admin")

    response = await client.patch(
        f"/api/auth/users/{admin.id}/reviewer-verification",
        json={
            "status": "verified",
            "practice_scope": "Emergency medicine educational simulation",
            "verification_note": "Attempted self-verification for test coverage.",
        },
        headers=headers_for(admin),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Administrators cannot verify their own clinician credentials"


@pytest.mark.asyncio
async def test_role_update_preserves_existing_reviewer_verification(
    client: AsyncClient,
    db: AsyncSession,
):
    admin = await create_user(db, email="admin-preserve-reviewer@test.com", role="admin")
    reviewer = await create_user(
        db,
        email="preserve-reviewer@test.com",
        role="clinician_reviewer",
    )
    reviewer.reviewer_verification_status = "verified"
    reviewer.reviewer_practice_scope = "Emergency medicine educational simulation"
    reviewer.reviewer_verified_at = datetime.now(timezone.utc)
    reviewer.reviewer_verified_by_user_id = admin.id
    await db.commit()

    response = await client.patch(
        f"/api/auth/users/{reviewer.id}/role",
        json={"role": "clinician_reviewer"},
        headers=headers_for(admin),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["reviewer_verification_status"] == "verified"
    assert body["reviewer_practice_scope"] == "Emergency medicine educational simulation"


@pytest.mark.asyncio
async def test_role_change_writes_reviewer_credential_events(
    client: AsyncClient,
    db: AsyncSession,
):
    admin = await create_user(db, email="admin-role-events@test.com", role="admin")
    learner = await create_user(db, email="role-events@test.com")

    assigned_response = await client.patch(
        f"/api/auth/users/{learner.id}/role",
        json={"role": "clinician_reviewer"},
        headers=headers_for(admin),
    )
    assert assigned_response.status_code == 200

    removed_response = await client.patch(
        f"/api/auth/users/{learner.id}/role",
        json={"role": "learner"},
        headers=headers_for(admin),
    )
    assert removed_response.status_code == 200

    history_response = await client.get(
        f"/api/auth/users/{learner.id}/reviewer-verification/history",
        headers=headers_for(admin),
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert [(event["action"], event["resulting_verification_status"]) for event in history] == [
        ("role_removed", "not_applicable"),
        ("role_assigned", "pending"),
    ]


@pytest.mark.asyncio
async def test_admin_cannot_remove_own_admin_role(
    client: AsyncClient,
    db: AsyncSession,
):
    admin = await create_user(db, email="self-demote-admin@test.com", role="admin")

    response = await client.patch(
        f"/api/auth/users/{admin.id}/role",
        json={"role": "learner"},
        headers=headers_for(admin),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Cannot remove your own admin role"


@pytest.mark.asyncio
async def test_admin_role_update_rejects_invalid_role(
    client: AsyncClient,
    db: AsyncSession,
):
    admin = await create_user(db, email="invalid-role-admin@test.com", role="admin")
    learner = await create_user(db, email="invalid-role-target@test.com")

    response = await client.patch(
        f"/api/auth/users/{learner.id}/role",
        json={"role": "doctor"},
        headers=headers_for(admin),
    )

    assert response.status_code == 422
    assert "role must be one of" in response.text
