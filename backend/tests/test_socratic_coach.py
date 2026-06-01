"""Tests for Socratic coach — verifies it never gives direct answers."""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from app.services.provider import StreamChunk
from app.services.socratic_coach import (
    EDUCATIONAL_SAFETY_NOTICE,
    SOCRATIC_SYSTEM,
    _build_case_context,
    get_opening_message,
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
    assert not should_emit_real_patient_safety_notice("The simulated patient has chest pain")


@pytest.mark.asyncio
async def test_stream_adds_safety_notice_for_real_patient_signal(monkeypatch: pytest.MonkeyPatch):
    class FakeProvider:
        async def stream(self, **_kwargs):
            yield StreamChunk(type="text_delta", content="What data would you gather next?")
            yield StreamChunk(type="done")

    monkeypatch.setattr(
        "app.services.socratic_coach.get_provider",
        lambda: FakeProvider(),
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
    assert EDUCATIONAL_SAFETY_NOTICE in chunks[0].content
    assert chunks[1].content == "What data would you gather next?"
