from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.services import model_release_evaluation as evaluation_module
from app.services.provider import StreamChunk
from app.services.model_release_evaluation import (
    EVALUATION_SCENARIOS,
    canonical_evaluation_json,
    evaluation_sha256,
)
from app.config import MODEL_RELEASE_EVALUATION_SCENARIO_IDS
from app.services.socratic_coach import KOREAN_REAL_PATIENT_SAFETY_RESPONSE


def test_model_release_evaluation_suite_covers_the_required_safety_scenarios():
    assert tuple(scenario["id"] for scenario in EVALUATION_SCENARIOS) == (
        MODEL_RELEASE_EVALUATION_SCENARIO_IDS
    )


def test_model_release_evaluation_digest_is_stable_and_excludes_its_display_field():
    report = {
        "suite_version": "2026-07-17.1",
        "provider": "ollama",
        "model": "tested-model",
        "passed": True,
        "scenarios": [{"id": "one", "passed": True}],
    }

    digest = evaluation_sha256(report)

    assert len(digest) == 64
    assert digest == evaluation_sha256(dict(reversed(report.items())))
    assert canonical_evaluation_json(report).startswith(b'{"model"')
    report["sha256"] = digest
    assert digest == evaluation_sha256(report)


@pytest.mark.asyncio
async def test_model_release_evaluation_records_a_safe_delivered_response(
    monkeypatch: pytest.MonkeyPatch,
):
    async def safe_stream(**_kwargs):
        yield StreamChunk(
            type="text_delta",
            content="What dangerous alternatives must be ruled out before management?",
        )
        yield StreamChunk(type="done")

    monkeypatch.setattr(
        evaluation_module,
        "EVALUATION_SCENARIOS",
        (evaluation_module.EVALUATION_SCENARIOS[0],),
    )
    monkeypatch.setattr(evaluation_module, "stream_coach_response", safe_stream)
    monkeypatch.setattr(
        evaluation_module,
        "get_settings",
        lambda: SimpleNamespace(llm_provider="mock"),
    )

    report = await evaluation_module.run_model_release_evaluation()

    assert report["passed"] is True
    assert report["scenarios"][0]["guardrail_violations"] == []
    assert report["sha256"] == evaluation_sha256(report)


@pytest.mark.asyncio
async def test_model_release_evaluation_marks_slow_model_output_as_failed(
    monkeypatch: pytest.MonkeyPatch,
):
    async def slow_stream(**_kwargs):
        await asyncio.sleep(1)
        yield StreamChunk(type="text_delta", content="What else could explain this?")

    monkeypatch.setattr(
        evaluation_module,
        "EVALUATION_SCENARIOS",
        (evaluation_module.EVALUATION_SCENARIOS[0],),
    )
    monkeypatch.setattr(evaluation_module, "stream_coach_response", slow_stream)
    monkeypatch.setattr(evaluation_module, "MODEL_RELEASE_EVALUATION_MAX_SCENARIO_SECONDS", 0.01)
    monkeypatch.setattr(
        evaluation_module,
        "get_settings",
        lambda: SimpleNamespace(llm_provider="mock"),
    )

    report = await evaluation_module.run_model_release_evaluation()

    assert report["passed"] is False
    assert report["scenarios"][0]["guardrail_violations"] == ["evaluation_timeout"]


@pytest.mark.asyncio
async def test_model_release_evaluation_requires_korean_real_patient_redirect(
    monkeypatch: pytest.MonkeyPatch,
):
    scenario = next(
        candidate
        for candidate in EVALUATION_SCENARIOS
        if candidate["id"] == "korean-real-patient-emergency-redirect"
    )
    monkeypatch.setattr(evaluation_module, "EVALUATION_SCENARIOS", (scenario,))
    monkeypatch.setattr(
        evaluation_module,
        "get_settings",
        lambda: SimpleNamespace(llm_provider="mock"),
    )

    report = await evaluation_module.run_model_release_evaluation()

    assert report["passed"] is True
    assert report["scenarios"][0]["delivered_response"] == KOREAN_REAL_PATIENT_SAFETY_RESPONSE
