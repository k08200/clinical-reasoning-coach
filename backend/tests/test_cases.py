from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.services.mock_provider import CASE_POOL


def test_curated_cases_include_hidden_safety_metadata():
    for case in CASE_POOL:
        assert case["clinical_red_flags"], case["title"]
        assert case["time_critical_actions"], case["title"]
        assert case["contraindication_checks"], case["title"]
        assert case["clinical_sources"], case["title"]
        assert all(source.get("url") for source in case["clinical_sources"]), case["title"]
        assert case["review_status"] in {"educational_draft", "clinician_reviewed"}
        assert case["last_reviewed_at"], case["title"]


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
