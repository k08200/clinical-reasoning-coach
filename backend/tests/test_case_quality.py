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
        "anaphylaxis_time_critical_actions",
        "anaphylaxis_observation_safety",
        "gi_bleed_time_critical_actions",
        "gi_bleed_transfusion_reversal_safety",
        "cns_infection_time_critical_actions",
        "cns_infection_lp_steroid_safety",
        "ectopic_pregnancy_time_critical_actions",
        "ectopic_pregnancy_treatment_safety",
        "severe_preeclampsia_time_critical_actions",
        "severe_preeclampsia_treatment_safety",
        "neutropenic_fever_time_critical_actions",
        "neutropenic_fever_treatment_safety",
        "severe_hypoglycemia_time_critical_actions",
        "severe_hypoglycemia_treatment_safety",
        "dka_time_critical_actions",
        "dka_contraindication_safety",
        "hyperkalemia_time_critical_actions",
        "hyperkalemia_treatment_safety",
        "status_epilepticus_time_critical_actions",
        "status_epilepticus_treatment_safety",
        "adrenal_crisis_time_critical_actions",
        "adrenal_crisis_treatment_safety",
        "acetaminophen_toxicity_time_critical_actions",
        "acetaminophen_toxicity_treatment_safety",
        "opioid_toxicity_time_critical_actions",
        "opioid_toxicity_treatment_safety",
        "severe_asthma_time_critical_actions",
        "severe_asthma_treatment_safety",
        "copd_exacerbation_time_critical_actions",
        "copd_exacerbation_treatment_safety",
        "acute_heart_failure_time_critical_actions",
        "acute_heart_failure_treatment_safety",
        "tension_pneumothorax_time_critical_actions",
        "tension_pneumothorax_treatment_safety",
        "stroke_time_critical_actions",
        "stroke_reperfusion_safety",
        "pe_time_critical_actions",
        "pe_contraindication_safety",
        "acs_time_critical_actions",
        "acs_contraindication_safety",
        "aortic_dissection_time_critical_actions",
        "aortic_dissection_treatment_safety",
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


def test_quality_gate_requires_anaphylaxis_time_critical_actions():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Anaphylaxis after peanut exposure"
    case["clinical_red_flags"] = [
        "Diffuse urticaria with wheeze and hypotension",
        "Angioedema with progressive airway symptoms",
    ]
    case["time_critical_actions"] = [
        "Place the patient on monitoring and establish IV access",
        "Prepare antihistamine therapy after initial stabilization",
    ]
    case["clinical_sources"][0]["supports"] = [
        *case["clinical_sources"][0]["supports"],
        "anaphylaxis diagnosis and severity assessment",
        "diffuse urticaria with wheeze and hypotension as red flags",
        "angioedema with progressive airway symptoms",
        "initial monitoring and IV access in anaphylaxis",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "anaphylaxis time-critical actions must include IM epinephrine" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_anaphylaxis_trigger_and_observation_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Anaphylaxis after peanut exposure"
    case["clinical_red_flags"] = [
        "Diffuse urticaria with wheeze and hypotension",
        "Angioedema with progressive airway symptoms",
    ]
    case["time_critical_actions"] = [
        "Give intramuscular epinephrine immediately for suspected anaphylaxis",
        "Assess airway, oxygenation, and prepare for intubation if swelling progresses",
        "Give IV fluids and escalate shock management if hypotension persists",
    ]
    case["contraindication_checks"] = [
        "Medication allergy list reviewed",
        "Pregnancy status if additional medications are considered",
    ]
    case["clinical_sources"][0]["supports"] = [
        *case["clinical_sources"][0]["supports"],
        "anaphylaxis diagnosis and severity assessment",
        "diffuse urticaria with wheeze and hypotension as red flags",
        "angioedema with progressive airway symptoms",
        "intramuscular epinephrine timing for anaphylaxis",
        "airway oxygenation assessment in anaphylaxis",
        "fluid resuscitation for hypotension in anaphylaxis",
        "medication allergy list reviewed",
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "anaphylaxis safety checks must include trigger or allergen exposure review" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_gi_bleed_time_critical_actions():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Upper GI bleed with hemorrhagic shock"
    case["chief_complaint"] = "Hematemesis and dizziness"
    case["history_of_present_illness"] = (
        "Older adult with large-volume hematemesis, melena, and near-syncope."
    )
    case["key_teaching_points"] = [
        "GI bleed severity depends on hemodynamics and ongoing blood loss",
        "Do not delay source control planning in unstable bleeding",
        "Anticoagulant exposure changes reversal and transfusion planning",
    ]
    case["clinical_red_flags"] = [
        "Hematemesis with hypotension",
        "Melena with tachycardia and near-syncope",
    ]
    case["time_critical_actions"] = [
        "Place the patient on monitoring and establish IV access",
        "Trend hemoglobin while assessing bleeding severity",
    ]
    case["contraindication_checks"] = [
        "Anticoagulant and antiplatelet exposure with INR and platelet review",
        "Blood type, crossmatch, consent, and transfusion reaction history before blood products",
    ]
    case["clinical_sources"] = [
        {
            "title": "Upper Gastrointestinal Bleeding Review",
            "organization": "National Library of Medicine",
            "url": "https://pubmed.ncbi.nlm.nih.gov/",
            "supports": [
                "GI bleed diagnosis and risk stratification",
                "hematemesis with hypotension as a red flag and severity marker",
                "melena with tachycardia and near-syncope as red flags",
                "hemodynamic monitoring and hemoglobin trend in GI bleeding",
                "anticoagulant and antiplatelet exposure with INR and platelet review",
                "blood type, crossmatch, consent, and transfusion reaction history before blood products",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "GI bleed time-critical actions must include hemodynamic resuscitation" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_gi_bleed_reversal_and_transfusion_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Upper GI bleed with hemorrhagic shock"
    case["chief_complaint"] = "Hematemesis and dizziness"
    case["history_of_present_illness"] = (
        "Older adult with large-volume hematemesis, melena, and near-syncope."
    )
    case["key_teaching_points"] = [
        "GI bleed severity depends on hemodynamics and ongoing blood loss",
        "Do not delay source control planning in unstable bleeding",
        "Anticoagulant exposure changes reversal and transfusion planning",
    ]
    case["clinical_red_flags"] = [
        "Hematemesis with hypotension",
        "Melena with tachycardia and near-syncope",
    ]
    case["time_critical_actions"] = [
        "Start hemodynamic resuscitation with two large-bore IVs",
        "Prepare type and crossmatch with packed RBC transfusion planning",
        "Consult gastroenterology for urgent endoscopy and hemostasis planning",
    ]
    case["contraindication_checks"] = [
        "Medication allergies before adjunctive therapies",
        "Renal function before contrast imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Upper Gastrointestinal Bleeding Review",
            "organization": "National Library of Medicine",
            "url": "https://pubmed.ncbi.nlm.nih.gov/",
            "supports": [
                "GI bleed diagnosis and risk stratification",
                "hematemesis with hypotension as a red flag and severity marker",
                "melena with tachycardia and near-syncope as red flags",
                "hemodynamic resuscitation with two large-bore IVs",
                "type and crossmatch with packed RBC transfusion planning",
                "urgent endoscopy and hemostasis planning",
                "medication allergies before adjunctive therapies",
                "renal function before contrast imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "GI bleed safety checks must include anticoagulant or coagulopathy reversal review" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_cns_infection_lp_ct_and_steroid_actions():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Bacterial meningitis"
    case["chief_complaint"] = "Fever, headache, and confusion"
    case["history_of_present_illness"] = (
        "Adult with abrupt fever, severe headache, neck stiffness, photophobia, "
        "and worsening confusion."
    )
    case["key_teaching_points"] = [
        "CNS infection can progress rapidly and requires immediate empiric therapy",
        "Lumbar puncture and CT sequencing depends on neurologic risk features",
        "Dexamethasone timing matters when bacterial meningitis is possible",
    ]
    case["clinical_red_flags"] = [
        "Fever with neck stiffness and photophobia",
        "Altered mental status suggesting invasive CNS infection",
    ]
    case["time_critical_actions"] = [
        "Obtain blood cultures promptly without delaying empiric antibiotics",
        "Start empiric ceftriaxone and vancomycin immediately",
    ]
    case["contraindication_checks"] = [
        "Antimicrobial allergy, renal function, and vancomycin dosing review",
        "Head CT before LP for papilledema, focal neurologic deficit, or mass lesion concern",
        "Dexamethasone before or with antibiotics when bacterial meningitis is possible",
    ]
    case["clinical_sources"] = [
        {
            "title": "Bacterial Meningitis Review",
            "organization": "National Library of Medicine",
            "url": "https://pubmed.ncbi.nlm.nih.gov/",
            "supports": [
                "CNS infection diagnosis and bacterial meningitis risk stratification",
                "fever with neck stiffness and photophobia as red flags",
                "altered mental status suggesting invasive CNS infection severity",
                "blood cultures promptly without delaying empiric antibiotics",
                "empiric ceftriaxone and vancomycin immediately",
                "antimicrobial allergy, renal function, and vancomycin dosing review",
                "head CT before LP for papilledema, focal neurologic deficit, or mass lesion concern",
                "dexamethasone before or with antibiotics when bacterial meningitis is possible",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "CNS infection time-critical actions must include blood cultures" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_cns_infection_lp_and_steroid_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Bacterial meningitis"
    case["chief_complaint"] = "Fever, headache, and confusion"
    case["history_of_present_illness"] = (
        "Adult with abrupt fever, severe headache, neck stiffness, photophobia, "
        "and worsening confusion."
    )
    case["key_teaching_points"] = [
        "CNS infection can progress rapidly and requires immediate empiric therapy",
        "Lumbar puncture and CT sequencing depends on neurologic risk features",
        "Dexamethasone timing matters when bacterial meningitis is possible",
    ]
    case["clinical_red_flags"] = [
        "Fever with neck stiffness and photophobia",
        "Altered mental status suggesting invasive CNS infection",
    ]
    case["time_critical_actions"] = [
        "Obtain blood cultures promptly without delaying empiric antibiotics",
        "Start empiric ceftriaxone and vancomycin immediately",
        "Assess lumbar puncture or head CT before LP pathway in parallel",
        "Give dexamethasone before or with antibiotics when bacterial meningitis is possible",
    ]
    case["contraindication_checks"] = [
        "Antimicrobial allergy, renal function, and vancomycin dosing review",
        "Medication pregnancy status before imaging if relevant",
    ]
    case["clinical_sources"] = [
        {
            "title": "Bacterial Meningitis Review",
            "organization": "National Library of Medicine",
            "url": "https://pubmed.ncbi.nlm.nih.gov/",
            "supports": [
                "CNS infection diagnosis and bacterial meningitis risk stratification",
                "fever with neck stiffness and photophobia as red flags",
                "altered mental status suggesting invasive CNS infection severity",
                "blood cultures promptly without delaying empiric antibiotics",
                "empiric ceftriaxone and vancomycin immediately",
                "lumbar puncture and head CT before LP pathway",
                "dexamethasone before or with antibiotics when bacterial meningitis is possible",
                "antimicrobial allergy, renal function, and vancomycin dosing review",
                "medication pregnancy status before imaging if relevant",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "CNS infection safety checks must include antimicrobial allergy" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_ectopic_pregnancy_hcg_ultrasound_and_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Ruptured ectopic pregnancy"
    case["patient_demographics"] = {
        "age": 29,
        "sex": "female",
        "weight_kg": 58,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Pelvic pain and dizziness"
    case["history_of_present_illness"] = (
        "Reproductive-age patient with missed period, unilateral pelvic pain, "
        "vaginal spotting, and near-syncope."
    )
    case["key_teaching_points"] = [
        "Early pregnancy pain and bleeding requires pregnancy location assessment",
        "Hemodynamic instability or peritoneal signs require urgent operative escalation",
        "Treatment choice depends on ultrasound findings, hCG trend, and rupture risk",
    ]
    case["clinical_red_flags"] = [
        "Near-syncope with pelvic pain and vaginal bleeding",
        "Shoulder pain and guarding suggesting intraperitoneal bleeding",
    ]
    case["time_critical_actions"] = [
        "Place patient on monitoring and establish IV access",
        "Trend hemoglobin while assessing bleeding severity",
    ]
    case["contraindication_checks"] = [
        "Pregnancy status with quantitative hCG before medication or imaging decisions",
        "Rh status and anti-D planning if Rh negative",
        "Methotrexate eligibility including renal and liver function, CBC, breastfeeding, rupture, and unstable status",
        "Hemodynamic instability, syncope, peritoneal signs, and hemoperitoneum risk",
    ]
    case["clinical_sources"] = [
        {
            "title": "Ectopic Pregnancy Diagnosis and Management",
            "organization": "American Family Physician",
            "url": "https://www.aafp.org/pubs/afp/issues/2020/0515/p599.html",
            "supports": [
                "ectopic pregnancy diagnosis and risk stratification",
                "near-syncope with pelvic pain and vaginal bleeding as red flags",
                "shoulder pain and guarding suggesting intraperitoneal bleeding",
                "monitoring, IV access, and hemoglobin trend while assessing bleeding severity",
                "pregnancy status with quantitative hCG before medication or imaging decisions",
                "Rh status and anti-D planning if Rh negative",
                "methotrexate eligibility including renal and liver function, CBC, breastfeeding, rupture, and unstable status",
                "hemodynamic instability, syncope, peritoneal signs, and hemoperitoneum risk",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "ectopic pregnancy time-critical actions must include quantitative hCG" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_ectopic_pregnancy_rh_mtx_and_rupture_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Ruptured ectopic pregnancy"
    case["patient_demographics"] = {
        "age": 29,
        "sex": "female",
        "weight_kg": 58,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Pelvic pain and dizziness"
    case["history_of_present_illness"] = (
        "Reproductive-age patient with missed period, unilateral pelvic pain, "
        "vaginal spotting, and near-syncope."
    )
    case["key_teaching_points"] = [
        "Early pregnancy pain and bleeding requires pregnancy location assessment",
        "Hemodynamic instability or peritoneal signs require urgent operative escalation",
        "Treatment choice depends on ultrasound findings, hCG trend, and rupture risk",
    ]
    case["clinical_red_flags"] = [
        "Near-syncope with pelvic pain and vaginal bleeding",
        "Shoulder pain and guarding suggesting intraperitoneal bleeding",
    ]
    case["time_critical_actions"] = [
        "Obtain pregnancy test and quantitative hCG immediately",
        "Perform pelvic ultrasound with transvaginal ultrasound to assess pregnancy location",
        "Consult OB/GYN urgently and prepare operative escalation if unstable or rupture is suspected",
    ]
    case["contraindication_checks"] = [
        "Pregnancy status with quantitative hCG before medication or imaging decisions",
        "Medication allergy before analgesia",
    ]
    case["clinical_sources"] = [
        {
            "title": "Ectopic Pregnancy Diagnosis and Management",
            "organization": "American Family Physician",
            "url": "https://www.aafp.org/pubs/afp/issues/2020/0515/p599.html",
            "supports": [
                "ectopic pregnancy diagnosis and risk stratification",
                "near-syncope with pelvic pain and vaginal bleeding as red flags",
                "shoulder pain and guarding suggesting intraperitoneal bleeding",
                "pregnancy test and quantitative hCG immediately",
                "pelvic ultrasound with transvaginal ultrasound to assess pregnancy location",
                "urgent OB/GYN consultation and operative escalation if unstable or rupture is suspected",
                "pregnancy status with quantitative hCG before medication or imaging decisions",
                "medication allergy before analgesia",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "ectopic pregnancy safety checks must include Rh status" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_severe_preeclampsia_magnesium_bp_delivery_and_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Severe preeclampsia with severe features"
    case["patient_demographics"] = {
        "age": 32,
        "sex": "female",
        "weight_kg": 72,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Headache and high blood pressure in late pregnancy"
    case["history_of_present_illness"] = (
        "Pregnant patient at 34 weeks presents with severe headache, visual symptoms, "
        "right upper quadrant pain, and repeated severe-range blood pressures."
    )
    case["key_teaching_points"] = [
        "Severe preeclampsia can progress to eclampsia, stroke, HELLP, and pulmonary edema",
        "Magnesium sulfate is used for seizure prophylaxis or treatment",
        "Acute severe hypertension requires prompt antihypertensive treatment and delivery planning",
    ]
    case["clinical_red_flags"] = [
        "Severe-range blood pressure with headache and visual symptoms",
        "Right upper quadrant pain with rising AST, low platelets, or pulmonary edema",
    ]
    case["time_critical_actions"] = [
        "Treat acute severe-range blood pressure with IV labetalol, hydralazine, or oral nifedipine",
        "Stabilize mother and plan delivery with fetal and maternal-fetal monitoring",
        "Escalate to obstetric, maternal-fetal medicine, anesthesia, and critical care consultation for seizure or pulmonary edema risk",
    ]
    case["contraindication_checks"] = [
        "Monitor magnesium toxicity with respiratory rate, deep tendon reflexes, urine output, and calcium gluconate readiness",
        "Review blood pressure, hypotension, asthma or bradycardia before labetalol, and nifedipine safety",
        "Check platelets, AST, ALT, creatinine, renal function, proteinuria, and HELLP labs",
        "Assess gestational age, fetal status, headache, visual symptoms, right upper quadrant pain, abruption, seizure, pulmonary edema, and delivery risk",
    ]
    case["clinical_sources"] = [
        {
            "title": "Emergent Therapy for Acute-Onset Severe Hypertension During Pregnancy and the Postpartum Period",
            "organization": "American College of Obstetricians and Gynecologists",
            "url": "https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2019/02/emergent-therapy-for-acute-onset-severe-hypertension-during-pregnancy-and-the-postpartum-period",
            "supports": [
                "severe preeclampsia with severe features diagnosis and risk stratification",
                "severe preeclampsia can progress to eclampsia, stroke, HELLP, and pulmonary edema",
                "magnesium sulfate for seizure prophylaxis or treatment",
                "acute severe hypertension requires prompt antihypertensive treatment and delivery planning",
                "severe-range blood pressure with headache and visual symptoms as red flags",
                "right upper quadrant pain with rising AST, low platelets, or pulmonary edema as severity markers",
                "acute severe-range blood pressure treatment with IV labetalol, hydralazine, or oral nifedipine",
                "mother stabilization and delivery planning with fetal and maternal-fetal monitoring",
                "obstetric, maternal-fetal medicine, anesthesia, and critical care consultation for seizure or pulmonary edema risk",
                "magnesium toxicity monitoring with respiratory rate, deep tendon reflexes, urine output, and calcium gluconate readiness",
                "blood pressure, hypotension, asthma or bradycardia before labetalol, and nifedipine safety",
                "platelets, AST, ALT, creatinine, renal function, proteinuria, and HELLP labs",
                "gestational age, fetal status, headache, visual symptoms, right upper quadrant pain, abruption, seizure, pulmonary edema, and delivery risk",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "severe preeclampsia or eclampsia time-critical actions must include magnesium sulfate"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_severe_preeclampsia_magnesium_toxicity_bp_labs_and_maternal_fetal_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Severe preeclampsia with severe features"
    case["patient_demographics"] = {
        "age": 32,
        "sex": "female",
        "weight_kg": 72,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Headache and high blood pressure in late pregnancy"
    case["history_of_present_illness"] = (
        "Pregnant patient at 34 weeks presents with severe headache, visual symptoms, "
        "right upper quadrant pain, and repeated severe-range blood pressures."
    )
    case["key_teaching_points"] = [
        "Severe preeclampsia can progress to eclampsia, stroke, HELLP, and pulmonary edema",
        "Magnesium sulfate is used for seizure prophylaxis or treatment",
        "Acute severe hypertension requires prompt antihypertensive treatment and delivery planning",
    ]
    case["clinical_red_flags"] = [
        "Severe-range blood pressure with headache and visual symptoms",
        "Right upper quadrant pain with rising AST, low platelets, or pulmonary edema",
    ]
    case["time_critical_actions"] = [
        "Start magnesium sulfate for seizure prophylaxis or treatment",
        "Treat acute severe-range blood pressure with IV labetalol, hydralazine, or oral nifedipine",
        "Stabilize mother and plan delivery with fetal and maternal-fetal monitoring",
        "Escalate to obstetric, maternal-fetal medicine, anesthesia, and critical care consultation for seizure or pulmonary edema risk",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Emergent Therapy for Acute-Onset Severe Hypertension During Pregnancy and the Postpartum Period",
            "organization": "American College of Obstetricians and Gynecologists",
            "url": "https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2019/02/emergent-therapy-for-acute-onset-severe-hypertension-during-pregnancy-and-the-postpartum-period",
            "supports": [
                "severe preeclampsia with severe features diagnosis and risk stratification",
                "severe preeclampsia can progress to eclampsia, stroke, HELLP, and pulmonary edema",
                "magnesium sulfate for seizure prophylaxis or treatment",
                "acute severe hypertension requires prompt antihypertensive treatment and delivery planning",
                "severe-range blood pressure with headache and visual symptoms as red flags",
                "right upper quadrant pain with rising AST, low platelets, or pulmonary edema as severity markers",
                "start magnesium sulfate for seizure prophylaxis or treatment",
                "acute severe-range blood pressure treatment with IV labetalol, hydralazine, or oral nifedipine",
                "mother stabilization and delivery planning with fetal and maternal-fetal monitoring",
                "obstetric, maternal-fetal medicine, anesthesia, and critical care consultation for seizure or pulmonary edema risk",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "severe preeclampsia or eclampsia safety checks must include magnesium toxicity monitoring"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_neutropenic_fever_anc_cultures_antipseudomonal_and_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Febrile neutropenia after chemotherapy"
    case["patient_demographics"] = {
        "age": 58,
        "sex": "female",
        "weight_kg": 63,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Fever after chemotherapy"
    case["history_of_present_illness"] = (
        "Patient on cytotoxic chemotherapy presents with fever 38.6 C, chills, "
        "mucositis, central venous catheter, and suspected ANC below 500."
    )
    case["key_teaching_points"] = [
        "Febrile neutropenia can progress rapidly with subtle localizing signs",
        "CBC with differential and ANC confirm severity but treatment should not wait",
        "Empiric antipseudomonal broad-spectrum antibiotics are time critical",
    ]
    case["clinical_red_flags"] = [
        "Fever with ANC below 500 after recent chemotherapy",
        "Hypotension, rigors, mucositis, central line tenderness, or pneumonia symptoms",
    ]
    case["time_critical_actions"] = [
        "Confirm CBC with differential and absolute neutrophil count ANC immediately",
        "Obtain blood cultures from peripheral and central line plus urine or source cultures without delaying therapy",
        "Admit and escalate to oncology or hematology with MASCC or CISNE sepsis-risk stratification",
    ]
    case["contraindication_checks"] = [
        "Review antibiotic allergy, creatinine, renal dosing, hepatic function, local antibiogram, and toxicity before cefepime or piperacillin-tazobactam",
        "Assess central line catheter infection, skin or soft tissue infection, pneumonia, MRSA, resistant gram-positive organism, and vancomycin indications",
        "Use MASCC or CISNE high risk or low risk score, comorbidity, social reliability, outpatient eligibility, discharge safety, and return precautions",
        "Reassess persistent fever or deterioration at 72 hours for resistant infection, fungal infection, and antifungal therapy need",
    ]
    case["clinical_sources"] = [
        {
            "title": "Neutropenic sepsis: prevention and management in people with cancer",
            "organization": "National Institute for Health and Care Excellence",
            "url": "https://www.nice.org.uk/guidance/cg151/chapter/Recommendations",
            "supports": [
                "febrile neutropenia after chemotherapy diagnosis and risk stratification",
                "febrile neutropenia can progress rapidly with subtle localizing signs",
                "CBC with differential and ANC confirm severity but treatment should not wait",
                "empiric antipseudomonal broad-spectrum antibiotics are time critical",
                "fever with ANC below 500 after recent chemotherapy as red flags",
                "hypotension, rigors, mucositis, central line tenderness, or pneumonia symptoms as severity markers",
                "CBC with differential and absolute neutrophil count ANC immediately",
                "blood cultures from peripheral and central line plus urine or source cultures without delaying therapy",
                "oncology or hematology escalation with MASCC or CISNE sepsis-risk stratification",
                "antibiotic allergy, creatinine, renal dosing, hepatic function, local antibiogram, and toxicity before cefepime or piperacillin-tazobactam",
                "central line catheter infection, skin or soft tissue infection, pneumonia, MRSA, resistant gram-positive organism, and vancomycin indications",
                "MASCC or CISNE high risk or low risk score, comorbidity, social reliability, outpatient eligibility, discharge safety, and return precautions",
                "persistent fever or deterioration at 72 hours for resistant infection, fungal infection, and antifungal therapy need",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "febrile neutropenia time-critical actions must include ANC or CBC confirmation"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_neutropenic_fever_antibiotic_central_line_risk_and_reassessment_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Febrile neutropenia after chemotherapy"
    case["patient_demographics"] = {
        "age": 58,
        "sex": "female",
        "weight_kg": 63,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Fever after chemotherapy"
    case["history_of_present_illness"] = (
        "Patient on cytotoxic chemotherapy presents with fever 38.6 C, chills, "
        "mucositis, central venous catheter, and suspected ANC below 500."
    )
    case["key_teaching_points"] = [
        "Febrile neutropenia can progress rapidly with subtle localizing signs",
        "CBC with differential and ANC confirm severity but treatment should not wait",
        "Empiric antipseudomonal broad-spectrum antibiotics are time critical",
    ]
    case["clinical_red_flags"] = [
        "Fever with ANC below 500 after recent chemotherapy",
        "Hypotension, rigors, mucositis, central line tenderness, or pneumonia symptoms",
    ]
    case["time_critical_actions"] = [
        "Confirm CBC with differential and absolute neutrophil count ANC immediately",
        "Obtain blood cultures from peripheral and central line plus urine or source cultures without delaying therapy",
        "Start empiric antipseudomonal broad-spectrum antibiotics within 1 hour with cefepime or piperacillin-tazobactam",
        "Admit and escalate to oncology or hematology with MASCC or CISNE sepsis-risk stratification",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Neutropenic sepsis: prevention and management in people with cancer",
            "organization": "National Institute for Health and Care Excellence",
            "url": "https://www.nice.org.uk/guidance/cg151/chapter/Recommendations",
            "supports": [
                "febrile neutropenia after chemotherapy diagnosis and risk stratification",
                "febrile neutropenia can progress rapidly with subtle localizing signs",
                "CBC with differential and ANC confirm severity but treatment should not wait",
                "empiric antipseudomonal broad-spectrum antibiotics are time critical",
                "fever with ANC below 500 after recent chemotherapy as red flags",
                "hypotension, rigors, mucositis, central line tenderness, or pneumonia symptoms as severity markers",
                "CBC with differential and absolute neutrophil count ANC immediately",
                "blood cultures from peripheral and central line plus urine or source cultures without delaying therapy",
                "empiric antipseudomonal broad-spectrum antibiotics within 1 hour with cefepime or piperacillin-tazobactam",
                "oncology or hematology escalation with MASCC or CISNE sepsis-risk stratification",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "febrile neutropenia safety checks must include antibiotic allergy"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_severe_hypoglycemia_glucose_rescue_recheck_and_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Severe hypoglycemia from long-acting insulin"
    case["patient_demographics"] = {
        "age": 71,
        "sex": "male",
        "weight_kg": 68,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Confusion and seizure with low blood glucose"
    case["history_of_present_illness"] = (
        "Patient with diabetes using basal insulin and possible sulfonylurea presents "
        "confused after poor oral intake, seizure, and blood glucose 40 mg/dL."
    )
    case["key_teaching_points"] = [
        "Severe hypoglycemia can cause seizure, coma, brain injury, and death",
        "Immediate glucose rescue should not wait for a full diagnostic workup",
        "Long-acting insulin or sulfonylurea exposure can cause recurrent hypoglycemia",
    ]
    case["clinical_red_flags"] = [
        "Altered mental status, seizure, or inability to swallow with low blood glucose",
        "Recurrent low glucose after dextrose, renal failure, alcohol use, or missed meals",
    ]
    case["time_critical_actions"] = [
        "Confirm bedside glucose and point-of-care glucose immediately",
        "Recheck blood glucose in 15 minutes and give a meal, snack, or protein-containing food to prevent recurrence",
        "Admit or hospitalize for prolonged monitoring if long-acting insulin, sulfonylurea, seizure, renal failure, or persistent altered mental status is present",
    ]
    case["contraindication_checks"] = [
        "Assess airway, aspiration risk, consciousness, seizure activity, NPO status, and ability to swallow before oral carbohydrate",
        "Monitor recurrent or rebound hypoglycemia from sulfonylurea or long-acting insulin with octreotide and observation planning",
        "Review renal failure, hepatic failure, alcohol use, adrenal insufficiency, missed meals, and dosing error as causes",
        "Plan safe discharge with diabetes education, insulin dose adjustment, meal access, driving restriction, return precautions, CGM, and glucagon prescription",
    ]
    case["clinical_sources"] = [
        {
            "title": "Hypoglycemia",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/endocrine-and-metabolic-disorders/diabetes-mellitus-and-hypoglycemia/hypoglycemia",
            "supports": [
                "severe hypoglycemia from long-acting insulin diagnosis and risk stratification",
                "severe hypoglycemia can cause seizure, coma, brain injury, and death",
                "immediate glucose rescue should not wait for a full diagnostic workup",
                "long-acting insulin or sulfonylurea exposure can cause recurrent hypoglycemia",
                "altered mental status, seizure, or inability to swallow with low blood glucose as red flags",
                "recurrent low glucose after dextrose, renal failure, alcohol use, or missed meals as severity markers",
                "bedside glucose and point-of-care glucose immediately",
                "blood glucose recheck in 15 minutes and meal, snack, or protein-containing food to prevent recurrence",
                "admission or hospitalization for prolonged monitoring with long-acting insulin, sulfonylurea, seizure, renal failure, or persistent altered mental status",
                "airway, aspiration risk, consciousness, seizure activity, NPO status, and ability to swallow before oral carbohydrate",
                "recurrent or rebound hypoglycemia from sulfonylurea or long-acting insulin with octreotide and observation planning",
                "renal failure, hepatic failure, alcohol use, adrenal insufficiency, missed meals, and dosing error causes",
                "safe discharge with diabetes education, insulin dose adjustment, meal access, driving restriction, return precautions, CGM, and glucagon prescription",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "severe hypoglycemia time-critical actions must include bedside" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_severe_hypoglycemia_airway_recurrence_cause_and_prevention_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Severe hypoglycemia from long-acting insulin"
    case["patient_demographics"] = {
        "age": 71,
        "sex": "male",
        "weight_kg": 68,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Confusion and seizure with low blood glucose"
    case["history_of_present_illness"] = (
        "Patient with diabetes using basal insulin and possible sulfonylurea presents "
        "confused after poor oral intake, seizure, and blood glucose 40 mg/dL."
    )
    case["key_teaching_points"] = [
        "Severe hypoglycemia can cause seizure, coma, brain injury, and death",
        "Immediate glucose rescue should not wait for a full diagnostic workup",
        "Long-acting insulin or sulfonylurea exposure can cause recurrent hypoglycemia",
    ]
    case["clinical_red_flags"] = [
        "Altered mental status, seizure, or inability to swallow with low blood glucose",
        "Recurrent low glucose after dextrose, renal failure, alcohol use, or missed meals",
    ]
    case["time_critical_actions"] = [
        "Confirm bedside glucose and point-of-care glucose immediately",
        "Give immediate IV dextrose D50 or D10, oral glucose if safe, or glucagon if IV access is unavailable",
        "Recheck blood glucose in 15 minutes and give a meal, snack, or protein-containing food to prevent recurrence",
        "Admit or hospitalize for prolonged monitoring if long-acting insulin, sulfonylurea, seizure, renal failure, or persistent altered mental status is present",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Hypoglycemia",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/endocrine-and-metabolic-disorders/diabetes-mellitus-and-hypoglycemia/hypoglycemia",
            "supports": [
                "severe hypoglycemia from long-acting insulin diagnosis and risk stratification",
                "severe hypoglycemia can cause seizure, coma, brain injury, and death",
                "immediate glucose rescue should not wait for a full diagnostic workup",
                "long-acting insulin or sulfonylurea exposure can cause recurrent hypoglycemia",
                "altered mental status, seizure, or inability to swallow with low blood glucose as red flags",
                "recurrent low glucose after dextrose, renal failure, alcohol use, or missed meals as severity markers",
                "bedside glucose and point-of-care glucose immediately",
                "immediate IV dextrose D50 or D10, oral glucose if safe, or glucagon if IV access is unavailable",
                "blood glucose recheck in 15 minutes and meal, snack, or protein-containing food to prevent recurrence",
                "admission or hospitalization for prolonged monitoring with long-acting insulin, sulfonylurea, seizure, renal failure, or persistent altered mental status",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "severe hypoglycemia safety checks must include airway" in issue
        for issue in report.critical_issues
    )


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


def test_quality_gate_requires_hyperkalemia_calcium_shift_and_removal_actions():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Severe hyperkalemia with ECG changes"
    case["chief_complaint"] = "Weakness and palpitations"
    case["history_of_present_illness"] = (
        "Patient with kidney disease presents with progressive weakness, palpitations, "
        "and missed dialysis."
    )
    case["key_teaching_points"] = [
        "Severe hyperkalemia with ECG changes can cause fatal arrhythmia",
        "Cardiac membrane stabilization precedes potassium shifting and removal",
        "Insulin-based shifting requires glucose monitoring and repeat potassium checks",
    ]
    case["clinical_red_flags"] = [
        "Peaked T waves and wide QRS on ECG",
        "K 7.1 mmol/L with missed dialysis and palpitations",
    ]
    case["time_critical_actions"] = [
        "Give insulin with dextrose and nebulized albuterol to shift potassium intracellularly",
        "Arrange urgent hemodialysis for potassium removal",
    ]
    case["contraindication_checks"] = [
        "Continuous ECG telemetry and repeat potassium monitoring after therapy",
        "Blood glucose and hypoglycemia monitoring after insulin and dextrose",
        "Renal failure, missed dialysis, ACE inhibitor, ARB, spironolactone, and potassium supplement medication review",
    ]
    case["clinical_sources"] = [
        {
            "title": "Hyperkalemia Emergency Treatment Guideline",
            "organization": "UK Kidney Association",
            "url": "https://ukkidney.org/health-professionals/guidelines/guidelines-commentaries/hyperkalaemia",
            "supports": [
                "severe hyperkalemia with ECG changes diagnosis and risk stratification",
                "peaked T waves and wide QRS on ECG as red flags",
                "K 7.1 mmol/L with missed dialysis and palpitations as severity markers",
                "insulin with dextrose and nebulized albuterol to shift potassium intracellularly",
                "urgent hemodialysis for potassium removal",
                "continuous ECG telemetry and repeat potassium monitoring after therapy",
                "blood glucose and hypoglycemia monitoring after insulin and dextrose",
                "renal failure, missed dialysis, ACE inhibitor, ARB, spironolactone, and potassium supplement medication review",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "severe hyperkalemia time-critical actions must include IV calcium" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_hyperkalemia_ecg_glucose_and_recurrence_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Severe hyperkalemia with ECG changes"
    case["chief_complaint"] = "Weakness and palpitations"
    case["history_of_present_illness"] = (
        "Patient with kidney disease presents with progressive weakness, palpitations, "
        "and missed dialysis."
    )
    case["key_teaching_points"] = [
        "Severe hyperkalemia with ECG changes can cause fatal arrhythmia",
        "Cardiac membrane stabilization precedes potassium shifting and removal",
        "Insulin-based shifting requires glucose monitoring and repeat potassium checks",
    ]
    case["clinical_red_flags"] = [
        "Peaked T waves and wide QRS on ECG",
        "K 7.1 mmol/L with missed dialysis and palpitations",
    ]
    case["time_critical_actions"] = [
        "Give IV calcium gluconate for cardiac membrane stabilization",
        "Give insulin with dextrose and nebulized albuterol to shift potassium intracellularly",
        "Arrange urgent hemodialysis for potassium removal",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before nebulized therapy",
        "Volume status before additional fluids",
    ]
    case["clinical_sources"] = [
        {
            "title": "Hyperkalemia Emergency Treatment Guideline",
            "organization": "UK Kidney Association",
            "url": "https://ukkidney.org/health-professionals/guidelines/guidelines-commentaries/hyperkalaemia",
            "supports": [
                "severe hyperkalemia with ECG changes diagnosis and risk stratification",
                "peaked T waves and wide QRS on ECG as red flags",
                "K 7.1 mmol/L with missed dialysis and palpitations as severity markers",
                "IV calcium gluconate for cardiac membrane stabilization",
                "insulin with dextrose and nebulized albuterol to shift potassium intracellularly",
                "urgent hemodialysis for potassium removal",
                "medication allergy before nebulized therapy",
                "volume status before additional fluids",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "severe hyperkalemia safety checks must include ECG or telemetry" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_status_epilepticus_airway_benzo_second_line_and_refractory_actions():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Convulsive status epilepticus"
    case["chief_complaint"] = "Ongoing convulsions"
    case["history_of_present_illness"] = (
        "Patient brought in with continuous generalized convulsions lasting more "
        "than 5 minutes and no return to baseline."
    )
    case["key_teaching_points"] = [
        "Prolonged convulsions require immediate staged treatment",
        "Benzodiazepines are first-line but should not delay second-line loading",
        "Refractory seizures require ICU-level escalation and continuous EEG planning",
    ]
    case["clinical_red_flags"] = [
        "Continuous seizure activity longer than 5 minutes",
        "Hypoxia and aspiration risk during ongoing convulsions",
    ]
    case["time_critical_actions"] = [
        "Give IV lorazepam immediately for ongoing seizure activity",
        "Load levetiracetam or fosphenytoin if seizures continue after benzodiazepine",
    ]
    case["contraindication_checks"] = [
        "Check bedside glucose and give dextrose with thiamine if hypoglycemia or malnutrition is possible",
        "Prepare airway support, suction, oxygen saturation monitoring, and respiratory depression safeguards after benzodiazepines",
        "Weight-based dosing plus renal, hepatic, pregnancy, ECG, and hypotension review before second-line antiseizure loading",
    ]
    case["clinical_sources"] = [
        {
            "title": "Evidence-Based Guideline: Treatment of Convulsive Status Epilepticus",
            "organization": "American Epilepsy Society",
            "url": "https://pubmed.ncbi.nlm.nih.gov/",
            "supports": [
                "convulsive status epilepticus diagnosis and staged treatment",
                "continuous seizure activity longer than 5 minutes as a red flag",
                "hypoxia and aspiration risk during ongoing convulsions",
                "IV lorazepam immediately for ongoing seizure activity",
                "levetiracetam or fosphenytoin loading if seizures continue after benzodiazepine",
                "bedside glucose and dextrose with thiamine if hypoglycemia or malnutrition is possible",
                "airway support, suction, oxygen saturation monitoring, and respiratory depression safeguards after benzodiazepines",
                "weight-based dosing plus renal, hepatic, pregnancy, ECG, and hypotension review before second-line antiseizure loading",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "status epilepticus time-critical actions must include airway" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_status_epilepticus_glucose_respiratory_and_asm_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Convulsive status epilepticus"
    case["chief_complaint"] = "Ongoing convulsions"
    case["history_of_present_illness"] = (
        "Patient brought in with continuous generalized convulsions lasting more "
        "than 5 minutes and no return to baseline."
    )
    case["key_teaching_points"] = [
        "Prolonged convulsions require immediate staged treatment",
        "Benzodiazepines are first-line but should not delay second-line loading",
        "Refractory seizures require ICU-level escalation and continuous EEG planning",
    ]
    case["clinical_red_flags"] = [
        "Continuous seizure activity longer than 5 minutes",
        "Hypoxia and aspiration risk during ongoing convulsions",
    ]
    case["time_critical_actions"] = [
        "Support airway and breathing with oxygen, suction, and intubation preparation",
        "Give IV lorazepam immediately for ongoing seizure activity",
        "Load levetiracetam or fosphenytoin if seizures continue after benzodiazepine",
        "Escalate refractory seizures to neurology, ICU, continuous EEG, and anesthetic infusion planning",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiseizure therapy",
        "Temperature and infection trigger assessment",
    ]
    case["clinical_sources"] = [
        {
            "title": "Evidence-Based Guideline: Treatment of Convulsive Status Epilepticus",
            "organization": "American Epilepsy Society",
            "url": "https://pubmed.ncbi.nlm.nih.gov/",
            "supports": [
                "convulsive status epilepticus diagnosis and staged treatment",
                "continuous seizure activity longer than 5 minutes as a red flag",
                "hypoxia and aspiration risk during ongoing convulsions",
                "airway and breathing support with oxygen, suction, and intubation preparation",
                "IV lorazepam immediately for ongoing seizure activity",
                "levetiracetam or fosphenytoin loading if seizures continue after benzodiazepine",
                "neurology, ICU, continuous EEG, and anesthetic infusion planning for refractory seizures",
                "medication allergy before antiseizure therapy",
                "temperature and infection trigger assessment",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "status epilepticus safety checks must include glucose or thiamine" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_adrenal_crisis_hydrocortisone_fluids_and_monitoring():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Adrenal crisis"
    case["chief_complaint"] = "Vomiting, weakness, and dizziness"
    case["history_of_present_illness"] = (
        "Patient with chronic steroid use presents with vomiting, abdominal pain, "
        "confusion, hypotension, and fever after missed doses."
    )
    case["key_teaching_points"] = [
        "Adrenal crisis is a life-threatening endocrine emergency",
        "Hydrocortisone should not be delayed for confirmatory testing",
        "Fluid resuscitation and glucose or electrolyte correction are time critical",
    ]
    case["clinical_red_flags"] = [
        "Hypotension with vomiting and confusion",
        "Hyponatremia, hyperkalemia, and hypoglycemia with missed steroid doses",
    ]
    case["time_critical_actions"] = [
        "Start isotonic saline fluid resuscitation with dextrose if hypoglycemia is present",
        "Monitor blood pressure, glucose, sodium, potassium, and shock response",
    ]
    case["contraindication_checks"] = [
        "Draw cortisol if feasible but do not delay immediate hydrocortisone for testing",
        "Monitor blood pressure, glucose, sodium, potassium, and other electrolytes during treatment",
        "Review infection, sepsis, missed steroid doses, steroid withdrawal, and stress dosing triggers",
    ]
    case["clinical_sources"] = [
        {
            "title": "Adrenal Insufficiency: Identification and Management",
            "organization": "National Institute for Health and Care Excellence",
            "url": "https://www.nice.org.uk/guidance/ng243",
            "supports": [
                "adrenal crisis diagnosis and risk stratification",
                "hypotension with vomiting and confusion as red flags",
                "hyponatremia, hyperkalemia, and hypoglycemia with missed steroid doses as severity markers",
                "isotonic saline fluid resuscitation with dextrose if hypoglycemia is present",
                "blood pressure, glucose, sodium, potassium, and shock response monitoring",
                "draw cortisol if feasible but do not delay immediate hydrocortisone for testing",
                "blood pressure, glucose, sodium, potassium, and electrolyte monitoring during treatment",
                "infection, sepsis, missed steroid doses, steroid withdrawal, and stress dosing triggers",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "adrenal crisis time-critical actions must include immediate hydrocortisone" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_adrenal_crisis_do_not_delay_monitoring_and_trigger_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Adrenal crisis"
    case["chief_complaint"] = "Vomiting, weakness, and dizziness"
    case["history_of_present_illness"] = (
        "Patient with chronic steroid use presents with vomiting, abdominal pain, "
        "confusion, hypotension, and fever after missed doses."
    )
    case["key_teaching_points"] = [
        "Adrenal crisis is a life-threatening endocrine emergency",
        "Hydrocortisone should not be delayed for confirmatory testing",
        "Fluid resuscitation and glucose or electrolyte correction are time critical",
    ]
    case["clinical_red_flags"] = [
        "Hypotension with vomiting and confusion",
        "Hyponatremia, hyperkalemia, and hypoglycemia with missed steroid doses",
    ]
    case["time_critical_actions"] = [
        "Give immediate IV hydrocortisone stress dose",
        "Start isotonic saline fluid resuscitation with dextrose if hypoglycemia is present",
        "Monitor blood pressure, glucose, sodium, potassium, and shock response",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetic therapy",
        "Volume overload risk before additional fluids",
    ]
    case["clinical_sources"] = [
        {
            "title": "Adrenal Insufficiency: Identification and Management",
            "organization": "National Institute for Health and Care Excellence",
            "url": "https://www.nice.org.uk/guidance/ng243",
            "supports": [
                "adrenal crisis diagnosis and risk stratification",
                "hypotension with vomiting and confusion as red flags",
                "hyponatremia, hyperkalemia, and hypoglycemia with missed steroid doses as severity markers",
                "immediate IV hydrocortisone stress dose",
                "isotonic saline fluid resuscitation with dextrose if hypoglycemia is present",
                "blood pressure, glucose, sodium, potassium, and shock response monitoring",
                "medication allergy before antiemetic therapy",
                "volume overload risk before additional fluids",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "adrenal crisis safety checks must include not delaying hydrocortisone" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_acetaminophen_level_nac_and_hepatic_monitoring():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acetaminophen toxicity"
    case["chief_complaint"] = "Intentional pill ingestion"
    case["history_of_present_illness"] = (
        "Patient presents several hours after ingesting a large quantity of pain "
        "medication with nausea and right upper quadrant discomfort."
    )
    case["key_teaching_points"] = [
        "Acetaminophen toxicity depends on timed serum concentration and ingestion timing",
        "N-acetylcysteine should be started promptly when criteria are met or timing is uncertain",
        "AST, ALT, INR, acidosis, encephalopathy, and transplant risk guide escalation",
    ]
    case["clinical_red_flags"] = [
        "Unknown ingestion time with repeated vomiting",
        "Right upper quadrant pain with rising AST and INR",
    ]
    case["time_critical_actions"] = [
        "Obtain timed acetaminophen level at 4 hours and plot on Rumack-Matthew nomogram",
        "Check AST, ALT, INR, hepatic function, and call poison center for toxicology guidance",
    ]
    case["contraindication_checks"] = [
        "Time of ingestion, extended-release formulation, co-ingestion, staggered ingestion, and repeated supratherapeutic use before nomogram interpretation",
        "Weight-based N-acetylcysteine dose, infusion timing, and anaphylactoid reaction safeguards",
        "INR, AST, ALT, acidosis, hypoglycemia, encephalopathy, liver failure, and transplant-risk monitoring",
    ]
    case["clinical_sources"] = [
        {
            "title": "Management of Acetaminophen Poisoning",
            "organization": "JAMA Network",
            "url": "https://jamanetwork.com/",
            "supports": [
                "acetaminophen toxicity diagnosis and risk stratification depends on timed serum concentration and ingestion timing",
                "unknown ingestion time with repeated vomiting as a red flag",
                "right upper quadrant pain with rising AST and INR as severity markers",
                "timed acetaminophen level at 4 hours and Rumack-Matthew nomogram planning",
                "AST, ALT, INR, hepatic function, and poison center toxicology guidance",
                "time of ingestion, extended-release formulation, co-ingestion, staggered ingestion, and repeated supratherapeutic use before nomogram interpretation",
                "weight-based N-acetylcysteine dose, infusion timing, and anaphylactoid reaction safeguards",
                "INR, AST, ALT, acidosis, hypoglycemia, encephalopathy, liver failure, and transplant-risk monitoring",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "acetaminophen toxicity time-critical actions must include a timed acetaminophen level"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_acetaminophen_timing_nac_and_liver_failure_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acetaminophen toxicity"
    case["chief_complaint"] = "Intentional pill ingestion"
    case["history_of_present_illness"] = (
        "Patient presents several hours after ingesting a large quantity of pain "
        "medication with nausea and right upper quadrant discomfort."
    )
    case["key_teaching_points"] = [
        "Acetaminophen toxicity depends on timed serum concentration and ingestion timing",
        "N-acetylcysteine should be started promptly when criteria are met or timing is uncertain",
        "AST, ALT, INR, acidosis, encephalopathy, and transplant risk guide escalation",
    ]
    case["clinical_red_flags"] = [
        "Unknown ingestion time with repeated vomiting",
        "Right upper quadrant pain with rising AST and INR",
    ]
    case["time_critical_actions"] = [
        "Obtain timed acetaminophen level at 4 hours and plot on Rumack-Matthew nomogram",
        "Start N-acetylcysteine treatment promptly when level, timing, or risk criteria indicate",
        "Check AST, ALT, INR, hepatic function, and call poison center for toxicology guidance",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Management of Acetaminophen Poisoning",
            "organization": "JAMA Network",
            "url": "https://jamanetwork.com/",
            "supports": [
                "acetaminophen toxicity diagnosis and risk stratification depends on timed serum concentration and ingestion timing",
                "unknown ingestion time with repeated vomiting as a red flag",
                "right upper quadrant pain with rising AST and INR as severity markers",
                "timed acetaminophen level at 4 hours and Rumack-Matthew nomogram planning",
                "N-acetylcysteine treatment promptly when level, timing, or risk criteria indicate",
                "AST, ALT, INR, hepatic function, and poison center toxicology guidance",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "acetaminophen toxicity safety checks must include ingestion timing" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_opioid_airway_naloxone_and_recurrent_monitoring():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Opioid toxicity"
    case["chief_complaint"] = "Found unresponsive"
    case["history_of_present_illness"] = (
        "Patient is found somnolent with slow breathing and pinpoint pupils after "
        "taking unknown pills."
    )
    case["key_teaching_points"] = [
        "Opioid toxicity is primarily a respiratory depression emergency",
        "Naloxone should be titrated to restore adequate ventilation",
        "Long-acting opioids can cause recurrent respiratory depression after naloxone wears off",
    ]
    case["clinical_red_flags"] = [
        "Bradypnea with low oxygen saturation",
        "Recurrent somnolence after initial naloxone response",
    ]
    case["time_critical_actions"] = [
        "Give titrated naloxone for suspected opioid toxicity",
        "Place on continuous monitoring with pulse oximetry and capnography and prepare repeat naloxone dosing",
    ]
    case["contraindication_checks"] = [
        "Assess methadone, fentanyl, extended-release, or long-acting opioid exposure and observe for renarcotization",
        "Check alcohol, benzodiazepine or sedative co-ingestion, hypoglycemia, and trauma as alternate causes",
        "Titrate naloxone to ventilation while preparing for acute withdrawal, aspiration, and pulmonary edema safeguards",
    ]
    case["clinical_sources"] = [
        {
            "title": "Opioid Toxicity",
            "organization": "NCBI Bookshelf",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK470415/",
            "supports": [
                "opioid toxicity diagnosis and respiratory depression risk stratification",
                "bradypnea with low oxygen saturation as a red flag",
                "recurrent somnolence after initial naloxone response as a severity marker",
                "titrated naloxone for suspected opioid toxicity",
                "continuous monitoring with pulse oximetry and capnography and repeat naloxone dosing",
                "methadone, fentanyl, extended-release, or long-acting opioid exposure and renarcotization observation",
                "alcohol, benzodiazepine or sedative co-ingestion, hypoglycemia, and trauma as alternate causes",
                "naloxone titration to ventilation with acute withdrawal, aspiration, and pulmonary edema safeguards",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "opioid toxicity time-critical actions must include airway or ventilatory support"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_opioid_rebound_coingestion_and_naloxone_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Opioid toxicity"
    case["chief_complaint"] = "Found unresponsive"
    case["history_of_present_illness"] = (
        "Patient is found somnolent with slow breathing and pinpoint pupils after "
        "taking unknown pills."
    )
    case["key_teaching_points"] = [
        "Opioid toxicity is primarily a respiratory depression emergency",
        "Naloxone should be titrated to restore adequate ventilation",
        "Long-acting opioids can cause recurrent respiratory depression after naloxone wears off",
    ]
    case["clinical_red_flags"] = [
        "Bradypnea with low oxygen saturation",
        "Recurrent somnolence after initial naloxone response",
    ]
    case["time_critical_actions"] = [
        "Support airway and ventilation with oxygen and bag-valve-mask if needed",
        "Give titrated naloxone for suspected opioid toxicity",
        "Place on continuous monitoring with pulse oximetry and capnography and prepare repeat naloxone dosing",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Opioid Toxicity",
            "organization": "NCBI Bookshelf",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK470415/",
            "supports": [
                "opioid toxicity diagnosis and respiratory depression risk stratification",
                "bradypnea with low oxygen saturation as a red flag",
                "recurrent somnolence after initial naloxone response as a severity marker",
                "airway and ventilation support with oxygen and bag-valve-mask if needed",
                "titrated naloxone for suspected opioid toxicity",
                "continuous monitoring with pulse oximetry and capnography and repeat naloxone dosing",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "opioid toxicity safety checks must include long-acting opioid" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_severe_asthma_oxygen_bronchodilators_steroids_and_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Severe asthma exacerbation"
    case["chief_complaint"] = "Shortness of breath and wheezing"
    case["history_of_present_illness"] = (
        "Patient presents with worsening dyspnea, chest tightness, accessory muscle "
        "use, and minimal relief after home inhaler treatments."
    )
    case["key_teaching_points"] = [
        "Severe asthma exacerbation can progress to respiratory failure",
        "Repeated or continuous SABA plus ipratropium treats acute airflow obstruction",
        "Systemic corticosteroids reduce relapse and should be started early",
    ]
    case["clinical_red_flags"] = [
        "Silent chest with fatigue and drowsiness",
        "Hypoxemia with persistent accessory muscle use",
    ]
    case["time_critical_actions"] = [
        "Give oxygen and prepare airway and ventilation support if respiratory failure develops",
        "Start repeated albuterol SABA nebulizers with ipratropium for severe bronchospasm",
        "Give IV magnesium and activate ICU or intubation escalation if poor response persists",
    ]
    case["contraindication_checks"] = [
        "Serial peak flow or FEV1, pulse oximetry, work of breathing, and response reassessment",
        "Review silent chest, fatigue, drowsiness, hypercapnia CO2, and intubation or ventilation risk",
        "Monitor tachycardia, arrhythmia, potassium hypokalemia, lactic acidosis, and trigger reassessment",
    ]
    case["clinical_sources"] = [
        {
            "title": "Managing Exacerbations of Asthma",
            "organization": "National Heart, Lung, and Blood Institute",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK7228/",
            "supports": [
                "severe asthma exacerbation diagnosis and respiratory failure risk stratification",
                "silent chest with fatigue and drowsiness as red flags",
                "hypoxemia with persistent accessory muscle use as severity markers",
                "oxygen and airway ventilation support if respiratory failure develops",
                "repeated albuterol SABA nebulizers with ipratropium for severe bronchospasm",
                "IV magnesium and ICU or intubation escalation if poor response persists",
                "serial peak flow or FEV1, pulse oximetry, work of breathing, and response reassessment",
                "silent chest, fatigue, drowsiness, hypercapnia CO2, and intubation or ventilation risk",
                "tachycardia, arrhythmia, potassium hypokalemia, lactic acidosis, and trigger reassessment",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "severe asthma time-critical actions must include oxygen or ventilatory support"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_severe_asthma_response_failure_and_treatment_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Severe asthma exacerbation"
    case["chief_complaint"] = "Shortness of breath and wheezing"
    case["history_of_present_illness"] = (
        "Patient presents with worsening dyspnea, chest tightness, accessory muscle "
        "use, and minimal relief after home inhaler treatments."
    )
    case["key_teaching_points"] = [
        "Severe asthma exacerbation can progress to respiratory failure",
        "Repeated or continuous SABA plus ipratropium treats acute airflow obstruction",
        "Systemic corticosteroids reduce relapse and should be started early",
    ]
    case["clinical_red_flags"] = [
        "Silent chest with fatigue and drowsiness",
        "Hypoxemia with persistent accessory muscle use",
    ]
    case["time_critical_actions"] = [
        "Give oxygen and prepare airway and ventilation support if respiratory failure develops",
        "Start repeated albuterol SABA nebulizers with ipratropium for severe bronchospasm",
        "Give systemic methylprednisolone corticosteroid early",
        "Give IV magnesium and activate ICU or intubation escalation if poor response persists",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Managing Exacerbations of Asthma",
            "organization": "National Heart, Lung, and Blood Institute",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK7228/",
            "supports": [
                "severe asthma exacerbation diagnosis and respiratory failure risk stratification",
                "silent chest with fatigue and drowsiness as red flags",
                "hypoxemia with persistent accessory muscle use as severity markers",
                "oxygen and airway ventilation support if respiratory failure develops",
                "repeated albuterol SABA nebulizers with ipratropium for severe bronchospasm",
                "systemic methylprednisolone corticosteroid early",
                "IV magnesium and ICU or intubation escalation if poor response persists",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "severe asthma safety checks must include serial severity or response monitoring"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_copd_controlled_oxygen_bronchodilators_steroids_antibiotics_and_niv():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "COPD exacerbation with acute hypercapnic respiratory failure"
    case["chief_complaint"] = "Worsening shortness of breath and sputum"
    case["history_of_present_illness"] = (
        "Patient with chronic obstructive pulmonary disease presents with worsening "
        "dyspnea, wheeze, increased purulent sputum, and somnolence."
    )
    case["key_teaching_points"] = [
        "COPD exacerbation requires controlled oxygen rather than uncontrolled high-flow oxygen",
        "Short-acting bronchodilators and systemic corticosteroids treat airflow obstruction",
        "Hypercapnic respiratory acidosis should prompt NIV or ventilatory escalation",
    ]
    case["clinical_red_flags"] = [
        "Somnolence with rising PaCO2 and respiratory acidosis",
        "Purulent sputum with fever and increased work of breathing",
    ]
    case["time_critical_actions"] = [
        "Start controlled oxygen by Venturi mask targeting SpO2 88-92% and obtain ABG",
        "Give albuterol SABA and ipratropium SAMA short-acting bronchodilators",
        "Start antibiotics when purulent sputum or pneumonia infection criteria are present",
        "Start NIV BiPAP for hypercapnic respiratory acidosis and prepare intubation if respiratory failure worsens",
    ]
    case["contraindication_checks"] = [
        "Repeat ABG pH, PaCO2, and oxygen saturation after controlled oxygen to avoid oxygen-induced hypercapnia",
        "Review NIV failure, altered mental status, fatigue, respiratory acidosis, and intubation criteria",
        "Assess pneumonia, pneumothorax, pulmonary embolism, acute heart failure, arrhythmia, and other triggers",
        "Monitor tachycardia, arrhythmia, potassium hypokalemia, glucose hyperglycemia, and steroid adverse effects",
    ]
    case["clinical_sources"] = [
        {
            "title": "Chronic Obstructive Pulmonary Disease",
            "organization": "NCBI Bookshelf",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK559281/",
            "supports": [
                "COPD exacerbation diagnosis and acute hypercapnic respiratory failure risk stratification",
                "somnolence with rising PaCO2 and respiratory acidosis as red flags",
                "purulent sputum with fever and increased work of breathing as severity markers",
                "controlled oxygen by Venturi mask targeting SpO2 88-92% and ABG",
                "albuterol SABA and ipratropium SAMA short-acting bronchodilators",
                "antibiotics when purulent sputum or pneumonia infection criteria are present",
                "NIV BiPAP for hypercapnic respiratory acidosis and intubation if respiratory failure worsens",
                "ABG pH, PaCO2, and oxygen saturation after controlled oxygen to avoid oxygen-induced hypercapnia",
                "NIV failure, altered mental status, fatigue, respiratory acidosis, and intubation criteria",
                "pneumonia, pneumothorax, pulmonary embolism, acute heart failure, arrhythmia, and other triggers",
                "tachycardia, arrhythmia, potassium hypokalemia, glucose hyperglycemia, and steroid adverse effects",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "COPD exacerbation time-critical actions must include controlled oxygen targeting 88-92%"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_copd_hypercapnia_niv_differential_and_adverse_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "COPD exacerbation with acute hypercapnic respiratory failure"
    case["chief_complaint"] = "Worsening shortness of breath and sputum"
    case["history_of_present_illness"] = (
        "Patient with chronic obstructive pulmonary disease presents with worsening "
        "dyspnea, wheeze, increased purulent sputum, and somnolence."
    )
    case["key_teaching_points"] = [
        "COPD exacerbation requires controlled oxygen rather than uncontrolled high-flow oxygen",
        "Short-acting bronchodilators and systemic corticosteroids treat airflow obstruction",
        "Hypercapnic respiratory acidosis should prompt NIV or ventilatory escalation",
    ]
    case["clinical_red_flags"] = [
        "Somnolence with rising PaCO2 and respiratory acidosis",
        "Purulent sputum with fever and increased work of breathing",
    ]
    case["time_critical_actions"] = [
        "Start controlled oxygen by Venturi mask targeting SpO2 88-92% and obtain ABG",
        "Give albuterol SABA and ipratropium SAMA short-acting bronchodilators",
        "Give systemic prednisone corticosteroid for COPD exacerbation",
        "Start antibiotics when purulent sputum or pneumonia infection criteria are present",
        "Start NIV BiPAP for hypercapnic respiratory acidosis and prepare intubation if respiratory failure worsens",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antibiotics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Chronic Obstructive Pulmonary Disease",
            "organization": "NCBI Bookshelf",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK559281/",
            "supports": [
                "COPD exacerbation diagnosis and acute hypercapnic respiratory failure risk stratification",
                "somnolence with rising PaCO2 and respiratory acidosis as red flags",
                "purulent sputum with fever and increased work of breathing as severity markers",
                "controlled oxygen by Venturi mask targeting SpO2 88-92% and ABG",
                "albuterol SABA and ipratropium SAMA short-acting bronchodilators",
                "systemic prednisone corticosteroid for COPD exacerbation",
                "antibiotics when purulent sputum or pneumonia infection criteria are present",
                "NIV BiPAP for hypercapnic respiratory acidosis and intubation if respiratory failure worsens",
                "medication allergy before antibiotics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "COPD exacerbation safety checks must include oxygen-induced hypercapnia"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_acute_hf_oxygen_diuresis_vasodilator_and_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acute heart failure with pulmonary edema"
    case["chief_complaint"] = "Severe shortness of breath"
    case["history_of_present_illness"] = (
        "Patient presents with abrupt dyspnea, orthopnea, hypoxemia, diffuse crackles, "
        "hypertension, and frothy sputum."
    )
    case["key_teaching_points"] = [
        "Acute pulmonary edema requires rapid oxygenation and ventilatory support when hypoxemic",
        "IV loop diuretics treat congestion and require renal and electrolyte monitoring",
        "Hypertensive acute heart failure may require blood-pressure-guided nitrate or vasodilator therapy",
    ]
    case["clinical_red_flags"] = [
        "Hypoxemia with severe respiratory distress and diffuse crackles",
        "Hypotension, altered mental status, and rising lactate suggesting cardiogenic shock",
    ]
    case["time_critical_actions"] = [
        "Start oxygen and CPAP noninvasive ventilation for pulmonary edema with respiratory failure risk",
        "Use blood-pressure-guided nitroglycerin nitrate vasodilator planning for hypertensive pulmonary edema",
        "Escalate to ICU, intubation, vasopressor, or inotrope support if cardiogenic shock develops",
    ]
    case["contraindication_checks"] = [
        "Check blood pressure, hypotension, aortic stenosis, right ventricular infarct, sildenafil, and nitrate or vasodilator contraindications",
        "Monitor renal function, creatinine, urine output, potassium, magnesium, and electrolytes during diuresis",
        "Assess acute coronary syndrome, myocardial infarction, arrhythmia, valvular disease, infection, pulmonary embolism, and other triggers",
        "Monitor lactate, hypoperfusion, altered mental status, cardiogenic shock, intubation need, and respiratory failure",
    ]
    case["clinical_sources"] = [
        {
            "title": "Acute Heart Failure in the 2021 ESC Heart Failure Guidelines",
            "organization": "European Society of Cardiology",
            "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC9020374/",
            "supports": [
                "acute heart failure with pulmonary edema diagnosis and risk stratification",
                "hypoxemia with severe respiratory distress and diffuse crackles as red flags",
                "hypotension, altered mental status, and rising lactate suggesting cardiogenic shock",
                "oxygen and CPAP noninvasive ventilation for pulmonary edema with respiratory failure risk",
                "blood-pressure-guided nitroglycerin nitrate vasodilator planning for hypertensive pulmonary edema",
                "ICU, intubation, vasopressor, or inotrope support if cardiogenic shock develops",
                "blood pressure, hypotension, aortic stenosis, right ventricular infarct, sildenafil, and nitrate or vasodilator contraindications",
                "renal function, creatinine, urine output, potassium, magnesium, and electrolytes during diuresis",
                "acute coronary syndrome, myocardial infarction, arrhythmia, valvular disease, infection, pulmonary embolism, and other triggers",
                "lactate, hypoperfusion, altered mental status, cardiogenic shock, intubation need, and respiratory failure",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "acute heart failure time-critical actions must include oxygen or noninvasive ventilation"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_acute_hf_bp_renal_trigger_and_shock_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acute heart failure with pulmonary edema"
    case["chief_complaint"] = "Severe shortness of breath"
    case["history_of_present_illness"] = (
        "Patient presents with abrupt dyspnea, orthopnea, hypoxemia, diffuse crackles, "
        "hypertension, and frothy sputum."
    )
    case["key_teaching_points"] = [
        "Acute pulmonary edema requires rapid oxygenation and ventilatory support when hypoxemic",
        "IV loop diuretics treat congestion and require renal and electrolyte monitoring",
        "Hypertensive acute heart failure may require blood-pressure-guided nitrate or vasodilator therapy",
    ]
    case["clinical_red_flags"] = [
        "Hypoxemia with severe respiratory distress and diffuse crackles",
        "Hypotension, altered mental status, and rising lactate suggesting cardiogenic shock",
    ]
    case["time_critical_actions"] = [
        "Start oxygen and CPAP noninvasive ventilation for pulmonary edema with respiratory failure risk",
        "Give IV furosemide loop diuretic for decongestion",
        "Use blood-pressure-guided nitroglycerin nitrate vasodilator planning for hypertensive pulmonary edema",
        "Escalate to ICU, intubation, vasopressor, or inotrope support if cardiogenic shock develops",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Acute Heart Failure in the 2021 ESC Heart Failure Guidelines",
            "organization": "European Society of Cardiology",
            "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC9020374/",
            "supports": [
                "acute heart failure with pulmonary edema diagnosis and risk stratification",
                "hypoxemia with severe respiratory distress and diffuse crackles as red flags",
                "hypotension, altered mental status, and rising lactate suggesting cardiogenic shock",
                "oxygen and CPAP noninvasive ventilation for pulmonary edema with respiratory failure risk",
                "IV furosemide loop diuretic for decongestion",
                "blood-pressure-guided nitroglycerin nitrate vasodilator planning for hypertensive pulmonary edema",
                "ICU, intubation, vasopressor, or inotrope support if cardiogenic shock develops",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "acute heart failure safety checks must include blood pressure" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_tension_pneumothorax_decompression_chest_tube_and_reassessment():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Tension pneumothorax"
    case["chief_complaint"] = "Severe chest pain and respiratory distress"
    case["history_of_present_illness"] = (
        "Patient develops sudden pleuritic chest pain, severe dyspnea, hypotension, "
        "and unilateral absent breath sounds after chest trauma."
    )
    case["key_teaching_points"] = [
        "Tension pneumothorax is a clinical diagnosis in an unstable patient",
        "Immediate needle or finger decompression should not wait for imaging",
        "Definitive tube thoracostomy and reassessment are required after decompression",
    ]
    case["clinical_red_flags"] = [
        "Hypotension with unilateral absent breath sounds",
        "Distended neck veins, tracheal deviation, and worsening hypoxemia",
    ]
    case["time_critical_actions"] = [
        "Support airway and oxygen ventilation while preparing decompression",
        "Perform immediate needle decompression or finger thoracostomy for tension physiology",
        "Reassess breath sounds, vital signs, hemodynamic response, lung sliding, and repeat exam after decompression",
    ]
    case["contraindication_checks"] = [
        "Clinical diagnosis in an unstable patient: do not delay decompression for x-ray, CT, or imaging",
        "Use large-bore sterile technique at the correct midaxillary or midclavicular intercostal site",
        "Monitor chest tube patency, tube position, recurrent pneumothorax, persistent air leak, and need for repeat decompression",
        "Review trauma, massive hemothorax, cardiac tamponade, pulmonary embolism, and other obstructive shock differentials",
    ]
    case["clinical_sources"] = [
        {
            "title": "Tension Pneumothorax",
            "organization": "NCBI Bookshelf",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK559090/",
            "supports": [
                "tension pneumothorax diagnosis and obstructive shock risk stratification",
                "hypotension with unilateral absent breath sounds as red flags",
                "distended neck veins, tracheal deviation, and worsening hypoxemia as severity markers",
                "airway and oxygen ventilation support while preparing decompression",
                "immediate needle decompression or finger thoracostomy for tension physiology",
                "breath sounds, vital signs, hemodynamic response, lung sliding, and repeat exam after decompression",
                "clinical diagnosis in an unstable patient and do not delay decompression for x-ray, CT, or imaging",
                "large-bore sterile technique at the correct midaxillary or midclavicular intercostal site",
                "chest tube patency, tube position, recurrent pneumothorax, persistent air leak, and repeat decompression",
                "trauma, massive hemothorax, cardiac tamponade, pulmonary embolism, and obstructive shock differentials",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "tension pneumothorax time-critical actions must include immediate needle or finger decompression"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_tension_pneumothorax_no_delay_site_recurrence_and_differential_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Tension pneumothorax"
    case["chief_complaint"] = "Severe chest pain and respiratory distress"
    case["history_of_present_illness"] = (
        "Patient develops sudden pleuritic chest pain, severe dyspnea, hypotension, "
        "and unilateral absent breath sounds after chest trauma."
    )
    case["key_teaching_points"] = [
        "Tension pneumothorax is a clinical diagnosis in an unstable patient",
        "Immediate needle or finger decompression should not wait for imaging",
        "Definitive tube thoracostomy and reassessment are required after decompression",
    ]
    case["clinical_red_flags"] = [
        "Hypotension with unilateral absent breath sounds",
        "Distended neck veins, tracheal deviation, and worsening hypoxemia",
    ]
    case["time_critical_actions"] = [
        "Support airway and oxygen ventilation while preparing decompression",
        "Perform immediate needle decompression or finger thoracostomy for tension physiology",
        "Place definitive chest tube with tube thoracostomy after initial decompression",
        "Reassess breath sounds, vital signs, hemodynamic response, lung sliding, and repeat exam after decompression",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before analgesia",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Tension Pneumothorax",
            "organization": "NCBI Bookshelf",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK559090/",
            "supports": [
                "tension pneumothorax diagnosis and obstructive shock risk stratification",
                "hypotension with unilateral absent breath sounds as red flags",
                "distended neck veins, tracheal deviation, and worsening hypoxemia as severity markers",
                "airway and oxygen ventilation support while preparing decompression",
                "immediate needle decompression or finger thoracostomy for tension physiology",
                "definitive chest tube with tube thoracostomy after initial decompression",
                "breath sounds, vital signs, hemodynamic response, lung sliding, and repeat exam after decompression",
                "medication allergy before analgesia",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "tension pneumothorax safety checks must include not delaying decompression"
        in issue
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


def test_quality_gate_requires_aortic_dissection_imaging_impulse_and_surgical_actions():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acute type A aortic dissection"
    case["chief_complaint"] = "Tearing chest and back pain"
    case["history_of_present_illness"] = (
        "Patient with abrupt maximal chest pain radiating to the back, syncope, "
        "and asymmetric arm blood pressures."
    )
    case["key_teaching_points"] = [
        "Acute aortic syndrome requires rapid definitive aortic imaging",
        "Anti-impulse therapy reduces aortic shear while the team prepares definitive care",
        "Type A involvement requires immediate surgical escalation or transfer",
    ]
    case["clinical_red_flags"] = [
        "Abrupt tearing chest pain radiating to the back",
        "Syncope with pulse deficit and asymmetric blood pressure",
    ]
    case["time_critical_actions"] = [
        "Place the patient on monitoring and repeat ECG while assessing dangerous chest pain",
        "Give analgesia while preparing for high-risk chest pain escalation",
    ]
    case["contraindication_checks"] = [
        "Avoid anticoagulation, heparin, antiplatelet escalation, and thrombolysis until aortic dissection management is established",
        "Use beta-blocker before vasodilator and monitor heart rate to prevent reflex tachycardia",
        "Assess pulse deficit, neurologic deficit, aortic regurgitation, pericardial effusion, tamponade, malperfusion, and rupture risk",
    ]
    case["clinical_sources"] = [
        {
            "title": "2022 ACC/AHA Guideline for the Diagnosis and Management of Aortic Disease",
            "organization": "American College of Cardiology / American Heart Association",
            "url": "https://www.acc.org/Guidelines",
            "supports": [
                "acute aortic syndrome diagnosis and aortic dissection risk stratification",
                "abrupt tearing chest pain radiating to the back as a high-risk feature",
                "syncope with pulse deficit and asymmetric blood pressure as severity markers",
                "monitoring and ECG while assessing dangerous chest pain",
                "analgesia while preparing for high-risk chest pain escalation",
                "avoid anticoagulation, heparin, antiplatelet escalation, and thrombolysis until aortic dissection management is established",
                "beta-blocker before vasodilator with heart rate monitoring to prevent reflex tachycardia",
                "pulse deficit, neurologic deficit, aortic regurgitation, pericardial effusion, tamponade, malperfusion, and rupture complications",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "aortic dissection time-critical actions must include definitive aortic imaging" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_aortic_dissection_antithrombotic_impulse_and_complication_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acute type A aortic dissection"
    case["chief_complaint"] = "Tearing chest and back pain"
    case["history_of_present_illness"] = (
        "Patient with abrupt maximal chest pain radiating to the back, syncope, "
        "and asymmetric arm blood pressures."
    )
    case["key_teaching_points"] = [
        "Acute aortic syndrome requires rapid definitive aortic imaging",
        "Anti-impulse therapy reduces aortic shear while the team prepares definitive care",
        "Type A involvement requires immediate surgical escalation or transfer",
    ]
    case["clinical_red_flags"] = [
        "Abrupt tearing chest pain radiating to the back",
        "Syncope with pulse deficit and asymmetric blood pressure",
    ]
    case["time_critical_actions"] = [
        "Obtain urgent CT angiography of the aorta or TEE if unstable",
        "Start anti-impulse therapy with IV esmolol for heart rate and blood pressure control plus pain control",
        "Consult cardiothoracic or vascular surgery and transfer to an aortic team for suspected type A dissection",
    ]
    case["contraindication_checks"] = [
        "Renal function and contrast allergy before CT angiography",
        "Medication allergy before analgesia",
    ]
    case["clinical_sources"] = [
        {
            "title": "2022 ACC/AHA Guideline for the Diagnosis and Management of Aortic Disease",
            "organization": "American College of Cardiology / American Heart Association",
            "url": "https://www.acc.org/Guidelines",
            "supports": [
                "acute aortic syndrome diagnosis and aortic dissection risk stratification",
                "abrupt tearing chest pain radiating to the back as a high-risk feature",
                "syncope with pulse deficit and asymmetric blood pressure as severity markers",
                "urgent CT angiography of the aorta or TEE if unstable",
                "anti-impulse therapy with IV esmolol for heart rate and blood pressure control plus pain control",
                "cardiothoracic or vascular surgery consultation and transfer to an aortic team for suspected type A dissection",
                "renal function and contrast allergy before CT angiography",
                "medication allergy before analgesia",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "aortic dissection safety checks must include antithrombotic" in issue
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


def test_quality_gate_rejects_korean_diagnosis_in_learner_visible_title():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "급성 허혈성 뇌졸중"
    case["title"] = "급성허혈성뇌졸중 환자의 초기 평가"

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "title must not reveal the diagnosis term '급성허혈성뇌졸중'" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_rejects_korean_single_token_diagnosis_in_visible_labs():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "폐렴"
    case["initial_labs"]["chest_xray"] = "우하엽 폐렴 소견"

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "initial_labs must not reveal the diagnosis term '폐렴'" in issue
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
