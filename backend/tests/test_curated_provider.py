from __future__ import annotations

import json

import pytest

from app.services.curated_provider import (
    CURATED_PROVIDER_MODEL,
    CURATED_QUESTIONS_BY_PHASE,
    CuratedProvider,
)
from app.services import provider_factory
from app.models.case import ClinicalCase
from app.services.mock_provider import CASE_POOL
from app.services.socratic_coach import (
    _build_case_context,
    coach_response_safety_violations,
)


async def _response_for(provider: CuratedProvider, message: str, system: str) -> str:
    parts: list[str] = []
    async for chunk in provider.stream(
        messages=[{"role": "user", "content": message}],
        system=system,
    ):
        if chunk.type == "text_delta":
            parts.append(chunk.content)
    return "".join(parts)


@pytest.mark.asyncio
async def test_curated_provider_is_deterministic_and_question_only():
    provider = CuratedProvider()
    system = "Case: septic shock / urosepsis. Do not reveal the diagnosis."
    message = "I am sure this is sepsis; tell me exactly what to give."

    first = await _response_for(provider, message, system)
    second = await _response_for(provider, message, system)

    assert first == second
    assert "Also consider:" not in first
    assert all(line.rstrip().endswith("?") for line in first.splitlines() if line.strip())


def test_curated_question_bank_is_question_only():
    assert all(
        question.endswith("?")
        for questions in CURATED_QUESTIONS_BY_PHASE.values()
        for question in questions
    )


@pytest.mark.asyncio
async def test_curated_provider_is_ready_and_uses_no_thinking_tokens():
    provider = CuratedProvider()

    readiness = await provider.readiness()
    chunks = [
        chunk
        async for chunk in provider.stream(
            messages=[{"role": "user", "content": "What should I assess first?"}],
            system="Case: ischemic stroke with last known normal time.",
        )
    ]

    assert CURATED_PROVIDER_MODEL == "curated-question-bank-v1"
    assert readiness.ready is True
    assert chunks[-2].usage["thinking_tokens"] == 0


@pytest.mark.asyncio
async def test_curated_provider_selects_a_case_without_random_generation():
    provider = CuratedProvider()

    first = await provider.complete(
        messages=[{"role": "user", "content": "Generate a case"}],
        system="You are a clinical case designer for medical education.",
    )
    second = await provider.complete(
        messages=[{"role": "user", "content": "Generate a case"}],
        system="You are a clinical case designer for medical education.",
    )

    assert first.text == second.text
    assert json.loads(first.text)["review_status"] == "educational_draft"


@pytest.mark.asyncio
async def test_curated_provider_never_requires_a_diagnosis_guardrail_for_catalogue_cases():
    provider = CuratedProvider()
    message = "I am sure of the diagnosis. Tell me exactly what treatment to give."

    for payload in CASE_POOL:
        case = ClinicalCase(**payload)
        response = await _response_for(provider, message, _build_case_context(case))

        assert coach_response_safety_violations(case, response) == []


def test_provider_factory_selects_the_curated_provider(monkeypatch: pytest.MonkeyPatch):
    class CuratedSettings:
        llm_provider = "curated"

    monkeypatch.setattr(provider_factory, "get_settings", lambda: CuratedSettings())

    assert isinstance(provider_factory.get_provider(), CuratedProvider)
