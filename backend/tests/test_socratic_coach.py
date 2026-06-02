"""Tests for Socratic coach — verifies it never gives direct answers."""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from app.services.provider import StreamChunk
from app.services.socratic_coach import (
    EDUCATIONAL_SAFETY_NOTICE,
    REAL_PATIENT_SAFETY_RESPONSE,
    SAFE_GUARDRAIL_RESPONSE,
    SOCRATIC_SYSTEM,
    _build_safety_focus_context,
    _build_case_context,
    get_opening_message,
    is_coach_response_safe,
    should_emit_real_patient_safety_notice,
    stream_coach_response,
)


def make_mock_case():
    case = MagicMock()
    case.diagnosis = "STEMI"
    case.coach_guidance = "Guide student to ECG and troponin"
    case.cognitive_traps = ["anchoring on GERD", "missing PE"]
    case.key_teaching_points = ["Always get ECG for chest pain", "Time is muscle"]
    case.clinical_red_flags = ["Diaphoresis with crushing chest pain"]
    case.time_critical_actions = ["12-lead ECG within 10 minutes"]
    case.contraindication_checks = ["Aortic dissection features before anticoagulation"]
    case.clinical_sources = [
        {
            "title": "Chest pain guideline",
            "organization": "Test Society",
            "url": "https://example.test/chest-pain",
            "supports": ["ECG timing"],
        }
    ]
    case.review_status = "educational_draft"
    case.last_reviewed_at = "2026-06-01"
    case.chief_complaint = "Chest pain"
    case.patient_demographics = {"age": 58, "sex": "male"}
    case.history_of_present_illness = "58yo male with acute chest pain and diaphoresis"
    case.past_medical_history = "Hypertension, hyperlipidemia"
    case.medications = ["lisinopril", "atorvastatin"]
    case.physical_exam = {
        "vitals": {"bp": "150/90", "hr": 95, "rr": 18, "temp_c": 37.0, "spo2": 96},
        "general": "Diaphoretic, distressed",
        "cardiovascular": "Regular rate, no murmurs",
        "pulmonary": "Clear to auscultation",
        "abdomen": "Soft, non-tender",
        "neuro": "Alert and oriented",
    }
    case.initial_labs = {"troponin": "0.02 (borderline)", "wbc": "11.2"}
    return case


def test_opening_message_contains_case_info():
    case = make_mock_case()
    msg = get_opening_message(case)
    assert "58" in msg
    assert "male" in msg
    assert "Chest pain" in msg
    assert "lisinopril" in msg
    assert EDUCATIONAL_SAFETY_NOTICE in msg


def test_opening_message_does_not_reveal_diagnosis():
    case = make_mock_case()
    msg = get_opening_message(case)
    # Should never mention the diagnosis
    assert "STEMI" not in msg
    assert "ST elevation" not in msg


def test_case_context_includes_hidden_safety_metadata():
    context = _build_case_context(make_mock_case())

    assert "Diaphoresis with crushing chest pain" in context
    assert "12-lead ECG within 10 minutes" in context
    assert "Aortic dissection features before anticoagulation" in context
    assert "Chest pain guideline" in context
    assert "educational_draft" in context


def test_safety_focus_context_only_lists_uncovered_targets():
    context = _build_safety_focus_context({
        "red_flags": [],
        "time_critical_actions": ["12-lead ECG within 10 minutes"],
        "contraindication_checks": ["Aortic dissection features before anticoagulation"],
    })

    assert "CURRENT TURN SAFETY FOCUS" in context
    assert "time-critical actions still needing learner planning" in context
    assert "safety checks still needed before management" in context
    assert "12-lead ECG within 10 minutes" in context
    assert "Aortic dissection features before anticoagulation" in context
    assert "red flags still needing learner consideration" not in context
    assert _build_safety_focus_context({
        "red_flags": [],
        "time_critical_actions": [],
        "contraindication_checks": [],
    }) == ""


def test_socratic_system_prompt_contains_rules():
    """Verify the system prompt enforces Socratic method."""
    assert "NEVER state" in SOCRATIC_SYSTEM
    assert "respond with questions" in SOCRATIC_SYSTEM
    assert "real patient" in SOCRATIC_SYSTEM
    assert "emergency services" in SOCRATIC_SYSTEM
    assert "diagnosis" in SOCRATIC_SYSTEM.lower()


def test_socratic_system_prompt_lists_biases():
    """Verify cognitive bias guidance is in the prompt."""
    # Prompt addresses bias via behavioral guidance (fixation, base rates)
    assert "fixates" in SOCRATIC_SYSTEM or "fixat" in SOCRATIC_SYSTEM
    assert "base rates" in SOCRATIC_SYSTEM.lower() or "alternative" in SOCRATIC_SYSTEM.lower()


def test_real_patient_safety_notice_detection():
    assert should_emit_real_patient_safety_notice("My patient is getting worse right now")
    assert should_emit_real_patient_safety_notice("Is this an emergency?")
    assert should_emit_real_patient_safety_notice("I can't breathe and have severe chest pain")
    assert not should_emit_real_patient_safety_notice("The simulated patient has chest pain")


def test_coach_response_guardrail_detects_unsafe_clinical_content():
    case = make_mock_case()

    assert is_coach_response_safe(case, "What finding would most change your differential?")
    assert not is_coach_response_safe(case, "This is STEMI.")
    assert not is_coach_response_safe(case, "You're on the right track.")
    assert not is_coach_response_safe(case, "You should give aspirin now.")


@pytest.mark.asyncio
async def test_stream_halts_for_real_patient_signal(monkeypatch: pytest.MonkeyPatch):
    class ProviderThatShouldNotBeCalled:
        async def stream(self, **_kwargs):
            raise AssertionError("provider should not be called for real-patient signals")

    monkeypatch.setattr(
        "app.services.socratic_coach.get_provider",
        lambda: ProviderThatShouldNotBeCalled(),
    )

    chunks = [
        chunk
        async for chunk in stream_coach_response(
            case=make_mock_case(),
            conversation_history=[],
            student_message="My patient is deteriorating right now",
            turn_number=1,
        )
    ]

    assert chunks[0].type == "text_delta"
    assert chunks[0].content == REAL_PATIENT_SAFETY_RESPONSE
    assert chunks[1].type == "done"


@pytest.mark.asyncio
async def test_stream_replaces_diagnosis_leak_with_safe_question(monkeypatch: pytest.MonkeyPatch):
    class UnsafeProvider:
        async def stream(self, **_kwargs):
            yield StreamChunk(type="text_delta", content="This is STEMI. ")
            yield StreamChunk(type="text_delta", content="You should activate the cath lab.")
            yield StreamChunk(type="done")

    monkeypatch.setattr(
        "app.services.socratic_coach.get_provider",
        lambda: UnsafeProvider(),
    )

    chunks = [
        chunk
        async for chunk in stream_coach_response(
            case=make_mock_case(),
            conversation_history=[],
            student_message="In this simulated case, I am building a differential.",
            turn_number=1,
        )
    ]

    response_text = "".join(chunk.content for chunk in chunks if chunk.type == "text_delta")
    assert response_text == SAFE_GUARDRAIL_RESPONSE
    assert "STEMI" not in response_text
    assert "cath lab" not in response_text


@pytest.mark.asyncio
async def test_stream_includes_current_safety_focus_in_system_prompt(
    monkeypatch: pytest.MonkeyPatch,
):
    captured: dict[str, str] = {}

    class CapturingProvider:
        async def stream(self, **kwargs):
            captured["system"] = kwargs["system"]
            yield StreamChunk(
                type="text_delta",
                content="What safety check would you complete before acting?",
            )
            yield StreamChunk(type="done")

    monkeypatch.setattr(
        "app.services.socratic_coach.get_provider",
        lambda: CapturingProvider(),
    )

    chunks = [
        chunk
        async for chunk in stream_coach_response(
            case=make_mock_case(),
            conversation_history=[],
            student_message="In this simulated case, I need to think before treatment.",
            turn_number=1,
            uncovered_safety_targets={
                "red_flags": [],
                "time_critical_actions": [],
                "contraindication_checks": [
                    "Aortic dissection features before anticoagulation",
                ],
            },
        )
    ]

    response_text = "".join(chunk.content for chunk in chunks if chunk.type == "text_delta")
    assert response_text == "What safety check would you complete before acting?"
    assert "CURRENT TURN SAFETY FOCUS" in captured["system"]
    assert "Aortic dissection features before anticoagulation" in captured["system"]
    assert "Do not quote, enumerate, or reveal this checklist" in captured["system"]
