"""Tests for MockProvider — rule-based Socratic coach and reasoning analyzer."""
from __future__ import annotations

import json
import pytest

from app.services.mock_provider import (
    CASE_POOL,
    MockProvider,
    SPECIALTY_QUESTIONS,
    _analyze_reasoning,
    _extract_hypothesis,
    _extract_student_response,
)


def _case_with_title(title: str) -> dict:
    return next(case for case in CASE_POOL if case["title"] == title)


# ─── _extract_student_response ────────────────────────────────────────────────

def test_extract_student_response_finds_quoted_text():
    prompt = (
        'Case summary: ...\n\n'
        'Turn 1 — Student response to analyze:\n"Give aspirin now."\n\nAnalyze...'
    )
    assert _extract_student_response(prompt) == "Give aspirin now."


def test_extract_student_response_falls_back_to_full_text():
    text = "No expected format here"
    assert _extract_student_response(text) == text


# ─── _extract_hypothesis ──────────────────────────────────────────────────────

def test_extract_hypothesis_known_diagnosis():
    # Word-boundary matching: "stemi" is checked before "mi", and \bmi\b won't match inside "stemi"
    assert _extract_hypothesis("I think this is STEMI") == "STEMI"
    assert _extract_hypothesis("Pulmonary embolism is likely") == "Pulmonary Embolism"
    assert _extract_hypothesis("aortic dissection needs ruling out") == "Aortic Dissection"
    assert _extract_hypothesis("possible MI with ACS") == "ACS"  # ACS listed before MI


def test_extract_hypothesis_unknown():
    assert _extract_hypothesis("unclear presentation") == "Under investigation"


# ─── _analyze_reasoning ───────────────────────────────────────────────────────

def test_analyze_reasoning_premature_closure():
    result = _analyze_reasoning("STEMI definitely. Give aspirin 300mg and heparin immediately.")
    assert result["reasoning_score"] < 60
    bias_types = [b["type"] for b in result["biases_detected"]]
    assert "premature_closure" in bias_types


def test_analyze_reasoning_anchoring_detected():
    result = _analyze_reasoning("This is definitely ACS and nothing else.")
    bias_types = [b["type"] for b in result["biases_detected"]]
    assert "anchoring" in bias_types


def test_analyze_reasoning_high_quality_scores_higher():
    poor = _analyze_reasoning("STEMI. Give aspirin.")
    good = _analyze_reasoning(
        "Differential: ACS, aortic dissection, PE. Borderline troponin cannot rule out ACS. "
        "BNP elevation with bibasilar crackles suggests early heart failure. "
        "Serial troponin needed. Hypertension and smoking are life-threatening risk factors. "
        "12-lead ECG immediately, then CXR and echo."
    )
    assert good["reasoning_score"] > poor["reasoning_score"]
    assert good["reasoning_score"] >= 60


def test_analyze_reasoning_score_bounded():
    result = _analyze_reasoning(
        "STEMI definitely clearly obviously must be. Give aspirin heparin tpa thrombolysis."
    )
    assert 0 <= result["reasoning_score"] <= 100


def test_analyze_reasoning_returns_required_fields():
    result = _analyze_reasoning("Chest pain, likely ACS.")
    assert "reasoning_score" in result
    assert "score_breakdown" in result
    assert "biases_detected" in result
    assert "reasoning_node" in result
    assert "student_strengths" in result
    assert "student_gaps" in result
    assert isinstance(result["biases_detected"], list)


def test_analyze_reasoning_score_breakdown_sums_to_total():
    result = _analyze_reasoning("ACS with troponin elevation and bibasilar crackles.")
    breakdown = result["score_breakdown"]
    total = sum(breakdown.values())
    assert total == result["reasoning_score"]


def test_analyze_reasoning_no_biases_for_clean_reasoning():
    # No bias triggers in this text
    result = _analyze_reasoning(
        "Considering ACS given risk factors and presentation. "
        "Serial troponin and ECG needed before any treatment decisions."
    )
    bias_types = [b["type"] for b in result["biases_detected"]]
    assert "premature_closure" not in bias_types
    assert "anchoring" not in bias_types


# ─── Premature closure — non-cardiac cases ───────────────────────────────────

def test_premature_closure_sepsis_antibiotics():
    result = _analyze_reasoning("Sepsis. Give antibiotics now and start vancomycin.")
    bias_types = [b["type"] for b in result["biases_detected"]]
    assert "premature_closure" in bias_types


def test_premature_closure_dka_insulin():
    result = _analyze_reasoning("DKA — start insulin drip immediately.")
    bias_types = [b["type"] for b in result["biases_detected"]]
    assert "premature_closure" in bias_types


def test_premature_closure_stroke_tpa():
    result = _analyze_reasoning("Ischemic stroke. Give tPA — give alteplase now.")
    bias_types = [b["type"] for b in result["biases_detected"]]
    assert "premature_closure" in bias_types


def test_premature_closure_pe_anticoagulation():
    result = _analyze_reasoning("PE — start anticoagulation with heparin drip.")
    bias_types = [b["type"] for b in result["biases_detected"]]
    assert "premature_closure" in bias_types


def test_no_premature_closure_when_antibiotics_mentioned_systematically():
    # Mentioning antibiotics in context of "need blood cultures before starting antibiotics"
    # should not trigger premature closure — requires phrase "give antibiotics" not just "antibiotics"
    result = _analyze_reasoning(
        "Suspect sepsis. Blood cultures needed before any antibiotics are started. "
        "Assess organ dysfunction with lactate, creatinine, and GCS."
    )
    bias_types = [b["type"] for b in result["biases_detected"]]
    assert "premature_closure" not in bias_types


# ─── Specialty detection ──────────────────────────────────────────────────────

def test_detect_specialty_sepsis():
    provider = MockProvider()
    system = "You are coaching a case involving septic shock and urosepsis."
    assert provider._detect_specialty(system) == "sepsis"


def test_detect_specialty_dka():
    provider = MockProvider()
    system = "Case involves diabetic ketoacidosis with anion gap acidosis."
    assert provider._detect_specialty(system) == "dka"


def test_detect_specialty_stroke():
    provider = MockProvider()
    system = "Ischemic stroke with last known normal and NIHSS score."
    assert provider._detect_specialty(system) == "stroke"


def test_detect_specialty_pe():
    provider = MockProvider()
    system = "Pulmonary embolism with right ventricular strain findings."
    assert provider._detect_specialty(system) == "pe"


def test_detect_specialty_returns_none_for_cardiac():
    provider = MockProvider()
    system = "ACS with chest pain and troponin elevation."
    assert provider._detect_specialty(system) is None


def test_specialty_questions_non_empty():
    for specialty in ("sepsis", "dka", "stroke", "pe"):
        assert len(SPECIALTY_QUESTIONS[specialty]) >= 5


def test_high_risk_demo_cases_avoid_misleading_risk_or_treatment_claims():
    pe_case = _case_with_title("Sudden Dyspnea in a Post-Surgical Patient")
    stroke_case = _case_with_title("Sudden Facial Droop and Speech Difficulty")
    dka_case = _case_with_title("Young Diabetic with Nausea and Abdominal Pain")

    assert "massive/submassive" not in pe_case["diagnosis"].lower()
    assert any("not by itself shock" in point for point in pe_case["key_teaching_points"])
    assert all("insufficient prophylaxis" not in point for point in pe_case["key_teaching_points"])

    assert "subtherapeutic anticoagulation" not in stroke_case["diagnosis"].lower()
    assert "inr_therapeutic_range" not in stroke_case["initial_labs"]
    assert "does not quantify apixaban activity" in stroke_case["initial_labs"]["inr"]
    assert any("does not alone establish thrombolysis eligibility" in point for point in stroke_case["key_teaching_points"])

    assert any("glucose at least 200 mg/dL" in point for point in dka_case["key_teaching_points"])
    assert any("ketoacidosis resolves" in point for point in dka_case["key_teaching_points"])


@pytest.mark.asyncio
async def test_stream_uses_specialty_question_for_sepsis():
    provider = MockProvider()
    sepsis_system = (
        "You are a Socratic coach. "
        "Case: septic shock / urosepsis. Sepsis-3 criteria met. "
        "Do not reveal the diagnosis."
    )
    chunks = []
    async for chunk in provider.stream(
        messages=[{"role": "user", "content": "Patient has fever and hypotension."}],
        system=sepsis_system,
    ):
        if chunk.type == "text_delta":
            chunks.append(chunk.content)
    response_text = "".join(chunks)
    # Any of these sepsis-specific keywords should appear somewhere
    sepsis_hints = ["lactate", "bundle", "source", "potassium", "creatinine",
                    "organ", "antibiotic", "cultures", "sepsis", "resuscitation"]
    assert any(hint in response_text.lower() for hint in sepsis_hints), (
        f"Expected specialty question but got: {response_text}"
    )


# ─── MockProvider.complete ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_mock_provider_complete_case_generation():
    provider = MockProvider()
    response = await provider.complete(
        messages=[{"role": "user", "content": "Generate a case"}],
        system="You are a clinical case designer for medical education.",
    )
    data = json.loads(response.text)
    assert "title" in data
    assert "diagnosis" in data


@pytest.mark.asyncio
async def test_mock_provider_complete_reasoning_analysis():
    provider = MockProvider()
    prompt = (
        "Case summary: Specialty: internal_medicine\n\n"
        "Turn 1 — Student response to analyze:\n"
        '"STEMI definitely. Give aspirin immediately."\n\n'
        "Analyze this student's clinical reasoning carefully."
    )
    response = await provider.complete(
        messages=[{"role": "user", "content": prompt}],
        system="You are an expert cognitive psychologist analyzing clinical reasoning.",
    )
    data = json.loads(response.text)
    assert "reasoning_score" in data
    assert isinstance(data["biases_detected"], list)


@pytest.mark.asyncio
async def test_mock_provider_complete_returns_llm_response():
    from app.services.provider import LLMResponse
    provider = MockProvider()
    response = await provider.complete(
        messages=[{"role": "user", "content": "Analyze: STEMI."}],
        system="Analyze clinical reasoning in a case.",
    )
    assert isinstance(response, LLMResponse)
    assert response.input_tokens > 0
    assert response.output_tokens > 0
