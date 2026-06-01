from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.utils.auth import create_access_token, create_refresh_token, hash_password


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


@pytest.mark.asyncio
async def test_get_me_no_token(client: AsyncClient):
    response = await client.get("/api/auth/me")
    assert response.status_code == 401
