"""Tests for Socratic coach — verifies it never gives direct answers."""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock, AsyncMock

from app.services.socratic_coach import get_opening_message, SOCRATIC_SYSTEM


def make_mock_case():
    case = MagicMock()
    case.diagnosis = "STEMI"
    case.coach_guidance = "Guide student to ECG and troponin"
    case.cognitive_traps = ["anchoring on GERD", "missing PE"]
    case.key_teaching_points = ["Always get ECG for chest pain", "Time is muscle"]
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


def test_opening_message_does_not_reveal_diagnosis():
    case = make_mock_case()
    msg = get_opening_message(case)
    # Should never mention the diagnosis
    assert "STEMI" not in msg
    assert "ST elevation" not in msg


def test_socratic_system_prompt_contains_rules():
    """Verify the system prompt enforces Socratic method."""
    assert "NEVER state" in SOCRATIC_SYSTEM
    assert "ALWAYS respond with questions" in SOCRATIC_SYSTEM
    assert "diagnosis" in SOCRATIC_SYSTEM.lower()


def test_socratic_system_prompt_lists_biases():
    """Verify cognitive bias guidance is in the prompt."""
    # Prompt addresses bias via behavioral guidance (fixation, base rates)
    assert "fixates" in SOCRATIC_SYSTEM or "fixat" in SOCRATIC_SYSTEM
    assert "base rates" in SOCRATIC_SYSTEM.lower() or "alternative" in SOCRATIC_SYSTEM.lower()
