from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from app.schemas.case import ClinicalCaseCreate
from app.services.case_generator import CASE_GENERATION_SYSTEM
from app.services.case_quality import assert_case_quality, evaluate_case_quality
from app.services.mock_provider import CASE_POOL

PARITY_FIXTURES_PATH = (
    Path(__file__).resolve().parents[2] / "shared" / "case_quality_parity_cases.json"
)


def test_curated_cases_pass_quality_gate():
    for case in CASE_POOL:
        report = evaluate_case_quality(ClinicalCaseCreate(**case))

        assert report.passed, f"{case['title']}: {report}"
        assert report.score >= 85


def test_quality_gate_matches_shared_frontend_parity_fixtures():
    fixtures = json.loads(PARITY_FIXTURES_PATH.read_text())

    for fixture in fixtures:
        case = copy.deepcopy(CASE_POOL[0])
        case.update(fixture["overrides"])

        report = evaluate_case_quality(ClinicalCaseCreate(**case))
        issues = report.critical_issues + report.warnings

        assert report.passed is fixture["expected_passed"], fixture["name"]
        for issue_substring in fixture.get("expected_issue_substrings", []):
            assert any(issue_substring in issue for issue in issues), fixture["name"]


def test_quality_gate_rejects_missing_safety_metadata():
    case = copy.deepcopy(CASE_POOL[0])
    case["clinical_red_flags"] = []

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any("clinical red flags" in issue for issue in report.critical_issues)


def test_quality_gate_rejects_future_review_date():
    case = copy.deepcopy(CASE_POOL[0])
    case["review_status"] = "clinician_reviewed"
    case["last_reviewed_at"] = "2099-01-01"

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any("future" in issue for issue in report.critical_issues)


def test_quality_gate_rejects_unrealistic_vitals():
    case = copy.deepcopy(CASE_POOL[0])
    case["physical_exam"]["vitals"]["spo2"] = 150

    with pytest.raises(ValueError, match="vitals.spo2"):
        assert_case_quality(ClinicalCaseCreate(**case))


def test_quality_gate_rejects_exact_ages_90_or_older():
    case = copy.deepcopy(CASE_POOL[0])
    case["patient_demographics"]["age"] = 92

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any("90+ age bucket" in issue for issue in report.critical_issues)


def test_quality_gate_allows_90_or_older_age_bucket():
    case = copy.deepcopy(CASE_POOL[0])
    case["patient_demographics"]["age"] = "90 or older"

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_requires_pregnancy_check_for_reproductive_age_female_cases():
    case = copy.deepcopy(CASE_POOL[0])
    case["patient_demographics"] = {
        "age": 32,
        "sex": "female",
        "weight_kg": 64,
        "ethnicity": "Korean",
    }

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "pregnancy status safety check is required" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_allows_reproductive_age_female_case_with_pregnancy_check():
    case = copy.deepcopy(CASE_POOL[0])
    case["patient_demographics"] = {
        "age": 32,
        "sex": "female",
        "weight_kg": 64,
        "ethnicity": "Korean",
    }
    case["contraindication_checks"] = [
        *case["contraindication_checks"],
        "Pregnancy status before antithrombotic therapy or radiation-based imaging",
    ]
    case["clinical_sources"][0]["supports"] = [
        *case["clinical_sources"][0]["supports"],
        "pregnancy status before antithrombotic therapy or radiation-based imaging",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_requires_weight_for_pediatric_cases():
    case = copy.deepcopy(CASE_POOL[0])
    case["patient_demographics"] = {
        "age": 8,
        "sex": "male",
        "ethnicity": "Korean",
    }

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "patient_demographics.weight_kg is required for pediatric cases" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_weight_based_safety_check_for_pediatric_cases():
    case = copy.deepcopy(CASE_POOL[0])
    case["patient_demographics"] = {
        "age": 8,
        "sex": "male",
        "weight_kg": 28,
        "ethnicity": "Korean",
    }

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "weight-based dosing safety check is required" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_allows_pediatric_case_with_weight_based_safety_check():
    case = copy.deepcopy(CASE_POOL[0])
    case["patient_demographics"] = {
        "age": 8,
        "sex": "male",
        "weight_kg": 28,
        "ethnicity": "Korean",
    }
    case["contraindication_checks"] = [
        *case["contraindication_checks"],
        "Weight-based dosing and fluid calculations before medication or bolus therapy",
    ]
    case["clinical_sources"][0]["supports"] = [
        *case["clinical_sources"][0]["supports"],
        "weight-based dosing and fluid calculations before medication or bolus therapy",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_requires_renal_safety_check_for_contrast_imaging():
    case = copy.deepcopy(CASE_POOL[0])
    case["time_critical_actions"] = [
        "Obtain CT pulmonary angiography promptly when pulmonary embolism remains high risk",
        "Escalate anticoagulation pathway planning after dangerous alternatives are addressed",
    ]
    case["contraindication_checks"] = [
        "Contrast allergy before CT pulmonary angiography",
        "Active bleeding risk before anticoagulation",
    ]
    case["clinical_sources"][0]["url"] = "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines"
    case["clinical_sources"][0]["supports"] = [
        "pulmonary embolism diagnosis and risk stratification pathway",
        "life-threatening chest pain differential and severity markers",
        "CT pulmonary angiography timing for high-risk suspected pulmonary embolism",
        "anticoagulation pathway escalation when dangerous alternatives are addressed",
        "crushing substernal chest pain radiating to the arm with diaphoresis",
        "bibasilar crackles suggesting early heart failure",
        "tachycardia with multiple coronary risk factors",
        "contrast allergy before CT pulmonary angiography",
        "active bleeding risk before anticoagulation",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "renal function safety check is required" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_allows_contrast_imaging_with_renal_safety_check():
    case = copy.deepcopy(CASE_POOL[0])
    case["time_critical_actions"] = [
        "Obtain CT pulmonary angiography promptly when pulmonary embolism remains high risk",
        "Escalate anticoagulation pathway planning after dangerous alternatives are addressed",
    ]
    case["contraindication_checks"] = [
        "Contrast allergy before CT pulmonary angiography",
        "Renal function and creatinine before contrast imaging",
        "Active bleeding risk before anticoagulation",
    ]
    case["clinical_sources"][0]["url"] = "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines"
    case["clinical_sources"][0]["supports"] = [
        "pulmonary embolism diagnosis and risk stratification pathway",
        "life-threatening chest pain differential and severity markers",
        "CT pulmonary angiography timing for high-risk suspected pulmonary embolism",
        "anticoagulation pathway escalation when dangerous alternatives are addressed",
        "crushing substernal chest pain radiating to the arm with diaphoresis",
        "bibasilar crackles suggesting early heart failure",
        "tachycardia with multiple coronary risk factors",
        "contrast allergy before CT pulmonary angiography",
        "renal function and creatinine before contrast imaging",
        "active bleeding risk before anticoagulation",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_rejects_non_numeric_blood_pressure():
    case = copy.deepcopy(CASE_POOL[0])
    case["physical_exam"]["vitals"]["bp"] = "normal"

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any("vitals.bp must use" in issue for issue in report.critical_issues)


def test_quality_gate_rejects_inverted_blood_pressure():
    case = copy.deepcopy(CASE_POOL[0])
    case["physical_exam"]["vitals"]["bp"] = "80/120"

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "systolic must be greater than diastolic" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_accepts_blood_pressure_with_units():
    case = copy.deepcopy(CASE_POOL[0])
    case["physical_exam"]["vitals"]["bp"] = "120/80 mmHg"

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_rejects_patient_identifiers_in_case_content():
    case = copy.deepcopy(CASE_POOL[0])
    case["history_of_present_illness"] = (
        "Patient name is John Smith, DOB 01/02/1970, MRN A123456. "
        "He presents with chest pressure and diaphoresis."
    )

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "case content must be de-identified" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_rejects_korean_patient_identifiers_in_case_content():
    case = copy.deepcopy(CASE_POOL[0])
    case["history_of_present_illness"] = (
        "환자 이름은 홍길동, 생년월일 1970-01-02, 등록번호 A123456입니다. "
        "흉통과 식은땀으로 내원했습니다."
    )

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "case content must be de-identified" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_rejects_diagnosis_in_learner_visible_title():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acute coronary syndrome"
    case["title"] = "Acute Coronary Syndrome in a Middle-Aged Patient"

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "title must not reveal the diagnosis term 'acute coronary syndrome'" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_rejects_diagnosis_acronym_in_learner_visible_history():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Diabetic Ketoacidosis"
    case["history_of_present_illness"] = (
        "22-year-old patient presents with nausea and dehydration after missing "
        "insulin; the triage note labels this as DKA."
    )

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "history_of_present_illness must not reveal the diagnosis term 'dka'" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_allows_diagnosis_terms_in_hidden_teaching_metadata():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Diabetic Ketoacidosis"
    case["key_teaching_points"] = [
        "DKA criteria include acidosis and ketones",
        "Potassium must be assessed before insulin",
        "Close the anion gap before transition",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_rejects_source_without_supports():
    case = copy.deepcopy(CASE_POOL[0])
    case["clinical_sources"] = [
        {
            "title": "Guideline",
            "organization": "Clinical Society",
            "url": "https://example.test/guideline",
            "supports": [],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any("clinical_sources[0]" in issue for issue in report.critical_issues)


def test_quality_gate_rejects_placeholder_source_url():
    case = copy.deepcopy(CASE_POOL[0])
    case["clinical_sources"] = [
        {
            "title": "Placeholder Guideline",
            "organization": "Placeholder Society",
            "url": "https://www.example.org/guideline",
            "supports": ["diagnosis", "safety checks"],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any("placeholder source domain" in issue for issue in report.critical_issues)


def test_quality_gate_rejects_low_trust_source_domain():
    case = copy.deepcopy(CASE_POOL[0])
    case["clinical_sources"][0]["url"] = "https://wellness-blog.com/chest-pain"

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "reputable clinical source domain" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_https_source_url():
    case = copy.deepcopy(CASE_POOL[0])
    case["clinical_sources"] = [
        {
            "title": "Guideline",
            "organization": "Clinical Society",
            "url": "http://clinical.example/guideline",
            "supports": ["diagnosis", "safety checks"],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any("valid HTTPS URL" in issue for issue in report.critical_issues)


def test_quality_gate_requires_text_source_supports():
    case = copy.deepcopy(CASE_POOL[0])
    case["clinical_sources"] = [
        {
            "title": "Guideline",
            "organization": "Clinical Society",
            "url": "https://clinical.example-source.test/guideline",
            "supports": ["diagnosis", {"safety": "checks"}],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any("supported case elements" in issue for issue in report.critical_issues)


def test_quality_gate_requires_source_supports_for_all_clinical_safety_scopes():
    case = copy.deepcopy(CASE_POOL[0])
    case["clinical_sources"][0]["supports"] = [
        "diagnosis and differential reasoning for acute chest pain",
        "red flags and severity markers for life-threatening chest pain",
        "time-critical ECG within 10 minutes",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "contraindication or safety checks" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_source_supports_to_anchor_safety_items():
    case = copy.deepcopy(CASE_POOL[0])
    case["clinical_sources"][0]["supports"] = [
        "diagnosis and differential reasoning for acute chest pain",
        "red flags and severity markers for unrelated abdominal pain",
        "time-critical antibiotics within 1 hour for unrelated infection",
        "contraindication and safety checks before unrelated antibiotic dosing",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "specifically anchor clinical red flags" in issue
        for issue in report.critical_issues
    )
    assert any(
        "specifically anchor time-critical actions" in issue
        for issue in report.critical_issues
    )
    assert any(
        "specifically anchor contraindication checks" in issue
        for issue in report.critical_issues
    )


def test_case_generation_prompt_requires_verifiable_sources():
    assert "real HTTPS url" in CASE_GENERATION_SYSTEM
    assert "professional society" in CASE_GENERATION_SYSTEM
    assert "peer-reviewed journal domain" in CASE_GENERATION_SYSTEM
    assert "at least two specific case" in CASE_GENERATION_SYSTEM
    assert "elements it supports" in CASE_GENERATION_SYSTEM
    assert "diagnosis/diagnostic" in CASE_GENERATION_SYSTEM
    assert "contraindication/safety checks" in CASE_GENERATION_SYSTEM
    assert "repeats its specific clinical keywords" in CASE_GENERATION_SYSTEM
    assert "real patient identifiers" in CASE_GENERATION_SYSTEM
    assert "Do NOT reveal the final diagnosis" in CASE_GENERATION_SYSTEM
    assert "Do NOT use exact ages above 89" in CASE_GENERATION_SYSTEM
    assert "Do not use placeholder" in CASE_GENERATION_SYSTEM
    assert "commercial" in CASE_GENERATION_SYSTEM
    assert "wellness pages" in CASE_GENERATION_SYSTEM
