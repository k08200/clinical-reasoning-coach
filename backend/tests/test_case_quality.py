from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from app.schemas.case import ClinicalCaseCreate
from app.services import case_quality as case_quality_module
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


def test_domain_safety_gate_registry_lists_expected_clinical_domains():
    gates = case_quality_module._domain_safety_gates()

    assert {gate.name for gate in gates} == {
        "infection_time_critical_actions",
        "infection_antimicrobial_safety",
        "sepsis_resuscitation_actions",
        "dka_time_critical_actions",
        "dka_contraindication_safety",
        "stroke_time_critical_actions",
        "stroke_reperfusion_safety",
        "pe_time_critical_actions",
        "pe_contraindication_safety",
        "acs_time_critical_actions",
        "acs_contraindication_safety",
    }
    assert {gate.field_name for gate in gates} <= {
        "time_critical_actions",
        "contraindication_checks",
    }
    assert all(gate.issue for gate in gates)


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


def test_quality_gate_requires_independent_sources_for_clinician_reviewed_cases():
    case = copy.deepcopy(CASE_POOL[0])
    case["review_status"] = "clinician_reviewed"
    case["last_reviewed_at"] = "2026-06-01"
    case["clinical_sources"] = [case["clinical_sources"][0]]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "at least 2 independent clinical source organizations" in issue
        for issue in report.critical_issues
    )


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
        "Risk stratify for massive versus submassive PE before choosing disposition",
        "Escalate anticoagulation pathway planning after dangerous alternatives are addressed and monitor for hypotension or RV strain",
        "Select CT pulmonary angiography or bedside echo pathway based on hemodynamic stability",
    ]
    case["contraindication_checks"] = [
        "Contrast allergy before CT pulmonary angiography",
        "Renal function and creatinine before contrast imaging",
        "Active bleeding risk before anticoagulation",
        "Pregnancy status when selecting PE imaging or anticoagulation",
    ]
    case["clinical_sources"][0]["url"] = "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines"
    case["clinical_sources"][0]["supports"] = [
        "pulmonary embolism diagnosis and risk stratification pathway",
        "life-threatening chest pain differential and severity markers",
        "massive versus submassive PE risk stratification before disposition",
        "anticoagulation pathway escalation when dangerous alternatives are addressed and hypotension or RV strain is monitored",
        "CT pulmonary angiography or bedside echo pathway based on hemodynamic stability",
        "crushing substernal chest pain radiating to the arm with diaphoresis",
        "bibasilar crackles suggesting early heart failure",
        "tachycardia with multiple coronary risk factors",
        "contrast allergy before CT pulmonary angiography",
        "renal function and creatinine before contrast imaging",
        "active bleeding risk before anticoagulation",
        "pregnancy status when selecting PE imaging or anticoagulation",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_requires_bleeding_safety_check_for_thrombolysis():
    case = copy.deepcopy(CASE_POOL[0])
    case["time_critical_actions"] = [
        "Start thrombolysis pathway immediately when criteria are met",
        "Activate reperfusion pathway for high-risk presentation",
    ]
    case["contraindication_checks"] = [
        "Pregnancy status before thrombolysis",
        "Renal function before contrast imaging",
    ]
    case["clinical_sources"][0]["supports"] = [
        "ACS diagnosis and risk stratification for acute chest pain",
        "life-threatening chest pain differential and severity markers",
        "thrombolysis pathway activation and reperfusion timing for high-risk presentation",
        "crushing substernal chest pain radiating to the arm with diaphoresis",
        "bibasilar crackles suggesting early heart failure",
        "tachycardia with multiple coronary risk factors",
        "pregnancy status before thrombolysis",
        "renal function before contrast imaging",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "bleeding risk safety check is required" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_allows_thrombolysis_with_bleeding_safety_check():
    case = copy.deepcopy(CASE_POOL[0])
    case["time_critical_actions"] = [
        "Obtain and interpret a 12-lead ECG within 10 minutes of presentation",
        "Start thrombolysis pathway immediately when criteria are met",
        "Activate reperfusion pathway for high-risk presentation",
        "Give antiplatelet and anticoagulation only after checking major contraindications",
    ]
    case["contraindication_checks"] = [
        "Pregnancy status before thrombolysis",
        "Renal function before contrast imaging",
        "Active bleeding, recent surgery, anticoagulant use, platelet count, and blood pressure before thrombolysis",
        "Aortic dissection features before anticoagulation or thrombolysis",
        "Hemodynamic instability or pulmonary edema requiring escalation",
    ]
    case["clinical_sources"][0]["supports"] = [
        "ACS diagnosis and risk stratification for acute chest pain",
        "life-threatening chest pain differential and severity markers",
        "ECG within 10 minutes for acute chest pain",
        "thrombolysis pathway activation and reperfusion timing for high-risk presentation",
        "antiplatelet and anticoagulation after checking major contraindications",
        "crushing substernal chest pain radiating to the arm with diaphoresis",
        "bibasilar crackles suggesting early heart failure",
        "tachycardia with multiple coronary risk factors",
        "pregnancy status before thrombolysis",
        "renal function before contrast imaging",
        "active bleeding, recent surgery, anticoagulant use, platelet count, and blood pressure before thrombolysis",
        "aortic dissection features before anticoagulation or thrombolysis",
        "hemodynamic instability or pulmonary edema requiring escalation",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_requires_infection_bundle_actions_for_sepsis_therapy():
    case = copy.deepcopy(CASE_POOL[1])
    case["time_critical_actions"] = [
        "Start broad-spectrum antibiotics within 1 hour",
        "Begin sepsis fluid resuscitation and reassessment",
    ]
    case["clinical_sources"][0]["supports"] = [
        "sepsis diagnosis and risk stratification",
        "hypotension, fever, and altered mental status as sepsis severity markers",
        "broad-spectrum antibiotics within 1 hour",
        "sepsis fluid resuscitation and reassessment",
        "hypotension with fever and altered mental status",
        "lactate 4.1 mmol/L suggesting tissue hypoperfusion",
        "AKI, thrombocytopenia, delayed urination, and poor perfusion",
        "renal impairment and allergy history before antibiotic selection or dosing",
        "volume overload risk during fluid resuscitation in CKD or heart failure",
        "need for vasopressors if hypotension persists after initial resuscitation",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "infection time-critical actions must include cultures" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_antimicrobial_safety_for_infection_therapy():
    case = copy.deepcopy(CASE_POOL[1])
    case["contraindication_checks"] = [
        "Volume overload risk during fluid resuscitation in CKD or heart failure",
        "Need for vasopressors if hypotension persists after initial resuscitation",
    ]
    case["clinical_sources"][0]["supports"] = [
        "lactate measurement and reassessment",
        "hypotension, fever, and altered mental status as sepsis severity markers",
        "lactate elevation and tissue hypoperfusion in septic shock",
        "AKI, thrombocytopenia, delayed urination, and poor perfusion as organ dysfunction",
        "suspected septic shock recognition and immediate escalation",
        "blood cultures and antimicrobial timing",
        "fluid reassessment and vasopressor escalation",
        "shock severity markers and organ dysfunction in sepsis diagnosis",
        "hypotension with fever and altered mental status",
        "lactate 4.1 mmol/L suggesting tissue hypoperfusion",
        "AKI, thrombocytopenia, delayed urination, and poor perfusion",
        "obtain blood cultures promptly without delaying empiric antibiotics",
        "start sepsis bundle actions including fluids, antibiotics, lactate reassessment, and source control planning",
        "volume overload risk during fluid resuscitation in CKD or heart failure",
        "need for vasopressors if hypotension persists after initial resuscitation",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "antimicrobial allergy and renal dosing safety checks are required" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_sepsis_lactate_fluid_and_vasopressor_actions():
    case = copy.deepcopy(CASE_POOL[1])
    case["time_critical_actions"] = [
        "Obtain blood cultures promptly without delaying empiric antibiotics",
        "Start broad-spectrum antibiotics and source control planning",
        "Escalate suspected sepsis urgently",
    ]
    case["clinical_sources"][0]["supports"] = [
        "sepsis diagnosis and risk stratification",
        "hypotension, fever, and altered mental status as sepsis severity markers",
        "lactate elevation and tissue hypoperfusion in septic shock",
        "AKI, thrombocytopenia, delayed urination, and poor perfusion as organ dysfunction",
        "blood cultures and antimicrobial timing",
        "source control planning",
        "renal impairment and allergy history before antibiotic selection or dosing",
        "volume overload risk during fluid resuscitation in CKD or heart failure",
        "need for vasopressors if hypotension persists after initial resuscitation",
        "obtain blood cultures promptly without delaying empiric antibiotics",
        "start broad-spectrum antibiotics and source control planning",
        "escalate suspected sepsis urgently",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "sepsis time-critical actions must include lactate" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_allows_sepsis_therapy_with_infection_safety_checks():
    case = copy.deepcopy(CASE_POOL[1])

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_requires_dka_potassium_and_closure_actions():
    case = copy.deepcopy(CASE_POOL[3])
    case["time_critical_actions"] = [
        "Start insulin infusion after DKA is recognized",
        "Begin fluid resuscitation for dehydration",
        "Identify precipitating cause",
    ]
    case["clinical_sources"][0]["supports"] = [
        "DKA diagnostic pattern",
        "acidosis, dehydration, and mental status severity markers",
        "severe metabolic acidosis with Kussmaul respirations",
        "tachycardia, dehydration signs, AKI, and confusion in DKA severity assessment",
        "hyperkalemia despite total body potassium depletion",
        "start insulin infusion after DKA is recognized",
        "begin fluid resuscitation for dehydration",
        "identify precipitating cause",
        "potassium below safe threshold before insulin infusion",
        "cerebral edema risk from overly rapid osmolar shifts",
        "persistent abdominal pain after metabolic correction requiring surgical reassessment",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "DKA time-critical actions must include potassium-before-insulin" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_dka_potassium_and_osmolar_safety_checks():
    case = copy.deepcopy(CASE_POOL[3])
    case["contraindication_checks"] = [
        "Need to exclude surgical abdomen if pain persists after metabolic correction",
        "Assess infection trigger before DKA protocol",
    ]
    case["clinical_sources"][0]["supports"] = [
        "DKA diagnostic pattern",
        "acidosis, dehydration, and mental status severity markers",
        "severe metabolic acidosis with Kussmaul respirations",
        "tachycardia, dehydration signs, AKI, and confusion in DKA severity assessment",
        "hyperkalemia despite total body potassium depletion",
        "potassium assessment before insulin therapy",
        "time-critical monitored DKA protocol with fluids, insulin planning, and anion-gap closure",
        "need to exclude surgical abdomen if pain persists after metabolic correction",
        "assess infection trigger before DKA protocol",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "DKA safety checks must include potassium threshold" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_allows_dka_therapy_with_insulin_safety_checks():
    case = copy.deepcopy(CASE_POOL[3])

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_requires_stroke_last_known_normal_and_imaging_actions():
    case = copy.deepcopy(CASE_POOL[4])
    case["time_critical_actions"] = [
        "Activate stroke pathway immediately",
        "Obtain noncontrast head CT to exclude hemorrhage without delaying treatment decision",
        "Assess thrombolysis and thrombectomy eligibility in parallel",
    ]
    case["clinical_sources"][0]["supports"] = [
        "acute stroke diagnosis and severity assessment",
        "sudden focal neurologic deficit and NIHSS severity assessment",
        "potentially treatable stroke within thrombolysis window",
        "atrial fibrillation with missed anticoagulation suggesting embolic risk",
        "activate stroke pathway immediately",
        "noncontrast head CT to exclude hemorrhage before treatment decision",
        "thrombolysis and thrombectomy eligibility in parallel",
        "intracranial hemorrhage or early extensive ischemic change on imaging",
        "recent anticoagulant use, bleeding history, platelet count, glucose, and blood pressure thresholds",
        "large vessel occlusion criteria and transfer needs for thrombectomy",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "stroke time-critical actions must include last-known-normal timing" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_stroke_reperfusion_contraindication_checks():
    case = copy.deepcopy(CASE_POOL[4])
    case["contraindication_checks"] = [
        "Intracranial hemorrhage or early extensive ischemic change on imaging",
        "Large vessel occlusion criteria and transfer needs for thrombectomy",
        "Recent bleeding history before thrombolysis",
    ]
    case["clinical_sources"][0]["supports"] = [
        "last-known-normal based reperfusion eligibility",
        "sudden focal neurologic deficit and NIHSS severity assessment",
        "potentially treatable stroke within thrombolysis window from last known normal",
        "atrial fibrillation with missed anticoagulation suggesting embolic risk",
        "noncontrast head CT to exclude hemorrhage before treatment decision",
        "establish last known normal and activate stroke pathway immediately",
        "assess thrombolysis and thrombectomy eligibility in parallel",
        "intracranial hemorrhage or early extensive ischemic change on imaging",
        "large vessel occlusion criteria and transfer needs for thrombectomy",
        "recent bleeding history before thrombolysis",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "stroke reperfusion safety checks must include hemorrhage exclusion" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_allows_stroke_reperfusion_with_required_safety_checks():
    case = copy.deepcopy(CASE_POOL[4])

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_requires_pe_risk_and_imaging_actions():
    case = copy.deepcopy(CASE_POOL[2])
    case["time_critical_actions"] = [
        "Start anticoagulation planning for suspected pulmonary embolism",
        "Give supplemental oxygen and monitor closely",
        "Escalate if symptoms worsen",
    ]
    case["clinical_sources"][0]["supports"] = [
        "pulmonary embolism diagnosis and risk stratification",
        "sudden dyspnea, hypoxemia, pleuritic chest pain, and recent surgery in PE assessment",
        "tachycardia, borderline blood pressure, and right heart strain as PE severity markers",
        "unilateral calf swelling and elevated D-dimer in suspected PE",
        "start anticoagulation planning for suspected pulmonary embolism",
        "give supplemental oxygen and monitor closely",
        "escalate if symptoms worsen",
        "bleeding risk, recent surgery, renal function, contrast allergy, and pregnancy safety checks",
        "pregnancy status when selecting imaging and anticoagulation",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "PE time-critical actions must include risk stratification" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_pe_bleeding_renal_and_pregnancy_safety():
    case = copy.deepcopy(CASE_POOL[2])
    case["contraindication_checks"] = [
        "Bleeding risk and recent surgery before thrombolysis or anticoagulation",
        "Contrast allergy before CT pulmonary angiography",
        "Need for escalation if hypotension persists",
    ]
    case["clinical_sources"][0]["supports"] = [
        "risk stratification by hemodynamic instability and RV strain",
        "sudden dyspnea, hypoxemia, pleuritic chest pain, and recent surgery in PE assessment",
        "tachycardia, borderline blood pressure, and right heart strain as PE severity markers",
        "unilateral calf swelling and elevated D-dimer in suspected PE",
        "massive versus submassive PE risk stratification before disposition",
        "urgent escalation for worsening hypotension, syncope, or shock",
        "imaging, bedside echo, and hemodynamic stability pathways",
        "bleeding risk and recent surgery before thrombolysis or anticoagulation",
        "contrast allergy before CT pulmonary angiography",
        "need for escalation if hypotension persists",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "PE safety checks must include bleeding or recent-surgery risk" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_allows_pe_with_required_risk_and_safety_checks():
    case = copy.deepcopy(CASE_POOL[2])

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed


def test_quality_gate_requires_acs_ecg_reperfusion_and_antithrombotic_actions():
    case = copy.deepcopy(CASE_POOL[0])
    case["time_critical_actions"] = [
        "Activate local ACS pathway when STEMI criteria are met",
        "Give antiplatelet and anticoagulation after checking major contraindications",
        "Escalate for shock or pulmonary edema",
    ]
    case["clinical_sources"][0]["supports"] = [
        "ACS diagnosis and risk stratification for acute chest pain",
        "life-threatening chest pain differential and severity markers",
        "local ACS pathway activation when STEMI criteria are met",
        "antiplatelet and anticoagulation after checking major contraindications",
        "escalation for shock or pulmonary edema",
        "crushing substernal chest pain radiating to the arm with diaphoresis",
        "bibasilar crackles suggesting early heart failure",
        "tachycardia with multiple coronary risk factors",
        "aortic dissection features before anticoagulation or thrombolysis",
        "active bleeding, severe allergy, or recent major surgery before antithrombotic therapy",
        "hemodynamic instability or pulmonary edema requiring escalation",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "ACS time-critical actions must include ECG within 10 minutes" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_acs_dissection_bleeding_and_hemodynamic_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["contraindication_checks"] = [
        "Active bleeding or recent major surgery before antithrombotic therapy",
        "Severe medication allergy before antithrombotic therapy",
    ]
    case["clinical_sources"][0]["supports"] = [
        "ACS diagnosis and risk stratification for acute chest pain",
        "life-threatening chest pain differential and severity markers",
        "ECG within 10 minutes and reperfusion pathway activation",
        "antiplatelet and anticoagulation after checking major contraindications",
        "crushing substernal chest pain radiating to the arm with diaphoresis",
        "bibasilar crackles suggesting early heart failure",
        "tachycardia with multiple coronary risk factors",
        "active bleeding or recent major surgery before antithrombotic therapy",
        "severe medication allergy before antithrombotic therapy",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "ACS safety checks must include aortic dissection exclusion" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_allows_acs_with_required_safety_checks():
    case = copy.deepcopy(CASE_POOL[0])

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


def test_quality_gate_rejects_single_token_diagnosis_in_learner_visible_title():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acute appendicitis"
    case["title"] = "Appendicitis in a Young Adult"

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "title must not reveal the diagnosis term 'appendicitis'" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_rejects_single_token_diagnosis_in_visible_labs():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Community-acquired pneumonia"
    case["initial_labs"]["chest_xray"] = "Right lower lobe pneumonia."

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "initial_labs must not reveal the diagnosis term 'pneumonia'" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_allows_non_answer_clinical_risk_terms_in_visible_history():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acute coronary syndrome"
    case["history_of_present_illness"] = (
        f"{case['history_of_present_illness']} He has multiple coronary risk factors."
    )

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert report.passed, report


def test_quality_gate_allows_diagnosis_terms_in_hidden_teaching_metadata():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Diabetic Ketoacidosis"
    case["key_teaching_points"] = [
        "DKA criteria include acidosis and ketones",
        "Potassium must be assessed before insulin",
        "Close the anion gap before transition",
    ]
    case["time_critical_actions"] = [
        *case["time_critical_actions"],
        "Plan monitored DKA fluids and insulin protocol after potassium assessment",
        "Close the anion gap before transition off insulin infusion",
    ]
    case["contraindication_checks"] = [
        *case["contraindication_checks"],
        "Potassium threshold and cerebral edema risk from osmolar shifts before insulin therapy",
    ]
    case["clinical_sources"] = [
        *case["clinical_sources"],
        {
            "title": "Standards of Care in Diabetes",
            "organization": "American Diabetes Association",
            "url": "https://professional.diabetes.org/standards-of-care",
            "supports": [
                "DKA criteria include acidosis and ketones",
                "potassium must be assessed before insulin",
                "plan monitored DKA fluids and insulin protocol after potassium assessment",
                "close the anion gap before transition off insulin infusion",
                "potassium threshold and cerebral edema risk from osmolar shifts before insulin therapy",
            ],
        },
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
    for source in case["clinical_sources"]:
        source["supports"] = [
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
    for source in case["clinical_sources"]:
        source["supports"] = [
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
    assert "elements it" in CASE_GENERATION_SYSTEM
    assert "supports" in CASE_GENERATION_SYSTEM
    assert "diagnosis/diagnostic" in CASE_GENERATION_SYSTEM
    assert "contraindication/safety checks" in CASE_GENERATION_SYSTEM
    assert "repeats its specific clinical keywords" in CASE_GENERATION_SYSTEM
    assert "real patient identifiers" in CASE_GENERATION_SYSTEM
    assert "Do NOT reveal the final diagnosis" in CASE_GENERATION_SYSTEM
    assert "Do NOT use exact ages above 89" in CASE_GENERATION_SYSTEM
    assert "Do not use placeholder" in CASE_GENERATION_SYSTEM
    assert "commercial" in CASE_GENERATION_SYSTEM
    assert "wellness pages" in CASE_GENERATION_SYSTEM
