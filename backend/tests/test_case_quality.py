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
        "malignant_hyperthermia_time_critical_actions",
        "malignant_hyperthermia_treatment_safety",
        "thyroid_storm_time_critical_actions",
        "thyroid_storm_treatment_safety",
        "heat_stroke_time_critical_actions",
        "heat_stroke_treatment_safety",
        "cauda_equina_time_critical_actions",
        "cauda_equina_delay_safety",
        "acute_limb_ischemia_time_critical_actions",
        "acute_limb_ischemia_treatment_safety",
        "testicular_torsion_time_critical_actions",
        "testicular_torsion_treatment_safety",
        "ovarian_torsion_time_critical_actions",
        "ovarian_torsion_treatment_safety",
        "spinal_epidural_abscess_time_critical_actions",
        "spinal_epidural_abscess_treatment_safety",
        "upper_gi_bleed_time_critical_actions",
        "upper_gi_bleed_treatment_safety",
        "acute_mesenteric_ischemia_time_critical_actions",
        "acute_mesenteric_ischemia_treatment_safety",
        "necrotizing_soft_tissue_infection_time_critical_actions",
        "necrotizing_soft_tissue_infection_treatment_safety",
        "ruptured_aaa_time_critical_actions",
        "ruptured_aaa_treatment_safety",
        "subarachnoid_hemorrhage_time_critical_actions",
        "subarachnoid_hemorrhage_treatment_safety",
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
        "toxic_alcohol_time_critical_actions",
        "toxic_alcohol_treatment_safety",
        "salicylate_toxicity_time_critical_actions",
        "salicylate_toxicity_treatment_safety",
        "carbon_monoxide_poisoning_time_critical_actions",
        "carbon_monoxide_poisoning_treatment_safety",
        "cyanide_poisoning_time_critical_actions",
        "cyanide_poisoning_treatment_safety",
        "opioid_toxicity_time_critical_actions",
        "opioid_toxicity_treatment_safety",
        "severe_asthma_time_critical_actions",
        "severe_asthma_treatment_safety",
        "copd_exacerbation_time_critical_actions",
        "copd_exacerbation_treatment_safety",
        "acute_heart_failure_time_critical_actions",
        "acute_heart_failure_treatment_safety",
        "cardiac_tamponade_time_critical_actions",
        "cardiac_tamponade_treatment_safety",
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


def test_quality_gate_requires_malignant_hyperthermia_trigger_stop_dantrolene_cooling_and_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Malignant hyperthermia crisis during anesthesia"
    case["patient_demographics"] = {
        "age": 24,
        "sex": "male",
        "weight_kg": 82,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Rapid hyperthermia and rigidity during anesthesia"
    case["history_of_present_illness"] = (
        "Patient under volatile anesthetic after succinylcholine develops rapidly rising "
        "ETCO2, tachycardia, masseter rigidity, acidosis, hyperkalemia, and fever."
    )
    case["key_teaching_points"] = [
        "Malignant hyperthermia is a life-threatening anesthesia emergency",
        "Triggering volatile anesthetics and succinylcholine must be stopped immediately",
        "Dantrolene plus active cooling and metabolic complication treatment are time critical",
    ]
    case["clinical_red_flags"] = [
        "Rapidly rising ETCO2 with tachycardia and masseter or generalized rigidity",
        "Hyperthermia with acidosis, hyperkalemia, cola-colored urine, or rhabdomyolysis",
    ]
    case["time_critical_actions"] = [
        "Stop triggering volatile agent and succinylcholine, halt procedure if possible, and ventilate with 100% oxygen using non-triggering anesthesia",
        "Start active cooling with ice, cold saline, and temperature monitoring",
        "Call for help, bring the MH cart, contact the malignant hyperthermia hotline, prepare ICU transfer, and monitor urine output",
    ]
    case["contraindication_checks"] = [
        "Monitor blood gas acidosis, potassium hyperkalemia, ECG arrhythmia, creatine kinase, calcium treatment need, and rhabdomyolysis",
        "Track core temperature, ETCO2 end-tidal CO2, myoglobinuria, urine output, and vital signs",
        "Review dantrolene dose, repeat dose need, weakness, recrudescence, and calcium channel blocker interaction risk",
        "Document family history, RYR1 genetic susceptibility, medical alert need, and future trigger-free non-triggering anesthesia planning",
    ]
    case["clinical_sources"] = [
        {
            "title": "Malignant Hyperthermia",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/injuries-poisoning/heat-illness/malignant-hyperthermia",
            "supports": [
                "malignant hyperthermia crisis during anesthesia diagnosis and risk stratification",
                "malignant hyperthermia is a life-threatening anesthesia emergency",
                "triggering volatile anesthetics and succinylcholine must be stopped immediately",
                "dantrolene plus active cooling and metabolic complication treatment are time critical",
                "rapidly rising ETCO2 with tachycardia and masseter or generalized rigidity as red flags",
                "hyperthermia with acidosis, hyperkalemia, cola-colored urine, or rhabdomyolysis as severity markers",
                "stop triggering volatile agent and succinylcholine, halt procedure if possible, and ventilate with 100% oxygen using non-triggering anesthesia",
                "active cooling with ice, cold saline, and temperature monitoring",
                "call for help, MH cart, malignant hyperthermia hotline, ICU transfer, and urine output monitoring",
                "blood gas acidosis, potassium hyperkalemia, ECG arrhythmia, creatine kinase, calcium treatment need, and rhabdomyolysis monitoring",
                "core temperature, ETCO2 end-tidal CO2, myoglobinuria, urine output, and vital signs tracking",
                "dantrolene dose, repeat dose need, weakness, recrudescence, and calcium channel blocker interaction risk",
                "family history, RYR1 genetic susceptibility, medical alert need, and future trigger-free non-triggering anesthesia planning",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "malignant hyperthermia time-critical actions must include stopping triggering"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_malignant_hyperthermia_metabolic_monitoring_dantrolene_and_trigger_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Malignant hyperthermia crisis during anesthesia"
    case["patient_demographics"] = {
        "age": 24,
        "sex": "male",
        "weight_kg": 82,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Rapid hyperthermia and rigidity during anesthesia"
    case["history_of_present_illness"] = (
        "Patient under volatile anesthetic after succinylcholine develops rapidly rising "
        "ETCO2, tachycardia, masseter rigidity, acidosis, hyperkalemia, and fever."
    )
    case["key_teaching_points"] = [
        "Malignant hyperthermia is a life-threatening anesthesia emergency",
        "Triggering volatile anesthetics and succinylcholine must be stopped immediately",
        "Dantrolene plus active cooling and metabolic complication treatment are time critical",
    ]
    case["clinical_red_flags"] = [
        "Rapidly rising ETCO2 with tachycardia and masseter or generalized rigidity",
        "Hyperthermia with acidosis, hyperkalemia, cola-colored urine, or rhabdomyolysis",
    ]
    case["time_critical_actions"] = [
        "Stop triggering volatile agent and succinylcholine, halt procedure if possible, and ventilate with 100% oxygen using non-triggering anesthesia",
        "Give immediate dantrolene from the MH cart",
        "Start active cooling with ice, cold saline, and temperature monitoring",
        "Call for help, bring the MH cart, contact the malignant hyperthermia hotline, prepare ICU transfer, and monitor urine output",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Malignant Hyperthermia",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/injuries-poisoning/heat-illness/malignant-hyperthermia",
            "supports": [
                "malignant hyperthermia crisis during anesthesia diagnosis and risk stratification",
                "malignant hyperthermia is a life-threatening anesthesia emergency",
                "triggering volatile anesthetics and succinylcholine must be stopped immediately",
                "dantrolene plus active cooling and metabolic complication treatment are time critical",
                "rapidly rising ETCO2 with tachycardia and masseter or generalized rigidity as red flags",
                "hyperthermia with acidosis, hyperkalemia, cola-colored urine, or rhabdomyolysis as severity markers",
                "stop triggering volatile agent and succinylcholine, halt procedure if possible, and ventilate with 100% oxygen using non-triggering anesthesia",
                "immediate dantrolene from the MH cart",
                "active cooling with ice, cold saline, and temperature monitoring",
                "call for help, MH cart, malignant hyperthermia hotline, ICU transfer, and urine output monitoring",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "malignant hyperthermia safety checks must include hyperkalemia" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_thyroid_storm_beta_blocker_thionamide_iodine_and_steroid_support():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Thyroid storm"
    case["patient_demographics"] = {
        "age": 39,
        "sex": "female",
        "weight_kg": 57,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Fever, agitation, and severe tachycardia"
    case["history_of_present_illness"] = (
        "Patient with Graves disease after infection presents with fever 40 C, "
        "delirium, atrial fibrillation, heart failure symptoms, vomiting, and severe tachycardia."
    )
    case["key_teaching_points"] = [
        "Thyroid storm is a life-threatening thyrotoxic crisis",
        "Treatment blocks adrenergic effects, hormone synthesis, hormone release, and T4 to T3 conversion",
        "Iodine should be given after thionamide to avoid fueling new hormone synthesis",
    ]
    case["clinical_red_flags"] = [
        "Hyperthermia with delirium, agitation, seizure, or coma",
        "Atrial fibrillation, heart failure, shock, vomiting, diarrhea, or infection trigger",
    ]
    case["time_critical_actions"] = [
        "Start propranolol beta-blocker or esmolol rate control for severe tachycardia if tolerated",
        "Give iodine or iodide such as Lugol solution or SSKI only after the correct sequence is planned",
        "Give hydrocortisone glucocorticoid steroid, active cooling with acetaminophen, ICU admission, and supportive care",
    ]
    case["contraindication_checks"] = [
        "Sequence thionamide before iodine or iodide and give iodine after thionamide, often at least one hour after PTU or methimazole",
        "Review beta-blocker contraindications including asthma, bronchospasm, decompensated heart failure, hypotension, or shock",
        "Check pregnancy status, CBC for agranulocytosis, liver transaminases, hepatic injury, and PTU hepatotoxicity risk",
        "Search for infection, thyroidectomy, MI, pulmonary embolism, arrhythmia, atrial fibrillation, and other precipitants with ICU monitoring",
    ]
    case["clinical_sources"] = [
        {
            "title": "Thyroid Storm",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/endocrine-and-metabolic-disorders/thyroid-disorders/thyroid-storm",
            "supports": [
                "thyroid storm diagnosis and risk stratification",
                "thyroid storm is a life-threatening thyrotoxic crisis",
                "treatment blocks adrenergic effects, hormone synthesis, hormone release, and T4 to T3 conversion",
                "iodine should be given after thionamide to avoid fueling new hormone synthesis",
                "hyperthermia with delirium, agitation, seizure, or coma as red flags",
                "atrial fibrillation, heart failure, shock, vomiting, diarrhea, or infection trigger as severity markers",
                "propranolol beta-blocker or esmolol rate control for severe tachycardia if tolerated",
                "iodine or iodide such as Lugol solution or SSKI only after the correct sequence is planned",
                "hydrocortisone glucocorticoid steroid, active cooling with acetaminophen, ICU admission, and supportive care",
                "thionamide before iodine or iodide and iodine after thionamide, often at least one hour after PTU or methimazole",
                "beta-blocker contraindications including asthma, bronchospasm, decompensated heart failure, hypotension, or shock",
                "pregnancy status, CBC for agranulocytosis, liver transaminases, hepatic injury, and PTU hepatotoxicity risk",
                "infection, thyroidectomy, MI, pulmonary embolism, arrhythmia, atrial fibrillation, and other precipitants with ICU monitoring",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "thyroid storm time-critical actions must include beta-blockade" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_thyroid_storm_iodine_sequence_beta_blocker_drug_and_trigger_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Thyroid storm"
    case["patient_demographics"] = {
        "age": 39,
        "sex": "female",
        "weight_kg": 57,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Fever, agitation, and severe tachycardia"
    case["history_of_present_illness"] = (
        "Patient with Graves disease after infection presents with fever 40 C, "
        "delirium, atrial fibrillation, heart failure symptoms, vomiting, and severe tachycardia."
    )
    case["key_teaching_points"] = [
        "Thyroid storm is a life-threatening thyrotoxic crisis",
        "Treatment blocks adrenergic effects, hormone synthesis, hormone release, and T4 to T3 conversion",
        "Iodine should be given after thionamide to avoid fueling new hormone synthesis",
    ]
    case["clinical_red_flags"] = [
        "Hyperthermia with delirium, agitation, seizure, or coma",
        "Atrial fibrillation, heart failure, shock, vomiting, diarrhea, or infection trigger",
    ]
    case["time_critical_actions"] = [
        "Start propranolol beta-blocker or esmolol rate control for severe tachycardia if tolerated",
        "Give PTU or methimazole thionamide antithyroid therapy",
        "Give iodine or iodide such as Lugol solution or SSKI after thionamide therapy",
        "Give hydrocortisone glucocorticoid steroid, active cooling with acetaminophen, ICU admission, and supportive care",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Thyroid Storm",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/endocrine-and-metabolic-disorders/thyroid-disorders/thyroid-storm",
            "supports": [
                "thyroid storm diagnosis and risk stratification",
                "thyroid storm is a life-threatening thyrotoxic crisis",
                "treatment blocks adrenergic effects, hormone synthesis, hormone release, and T4 to T3 conversion",
                "iodine should be given after thionamide to avoid fueling new hormone synthesis",
                "hyperthermia with delirium, agitation, seizure, or coma as red flags",
                "atrial fibrillation, heart failure, shock, vomiting, diarrhea, or infection trigger as severity markers",
                "propranolol beta-blocker or esmolol rate control for severe tachycardia if tolerated",
                "PTU or methimazole thionamide antithyroid therapy",
                "iodine or iodide such as Lugol solution or SSKI after thionamide therapy",
                "hydrocortisone glucocorticoid steroid, active cooling with acetaminophen, ICU admission, and supportive care",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "thyroid storm safety checks must include iodine-after-thionamide" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_heat_stroke_core_temp_rapid_cooling_resuscitation_and_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Exertional heat stroke"
    case["patient_demographics"] = {
        "age": 19,
        "sex": "male",
        "weight_kg": 74,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Collapse with confusion during summer training"
    case["history_of_present_illness"] = (
        "Athlete collapses during hot-weather training with altered mental status, "
        "seizure-like activity, hot skin, tachycardia, and suspected core temperature above 40 C."
    )
    case["key_teaching_points"] = [
        "Heat stroke is hyperthermia with central nervous system dysfunction",
        "Rapid whole-body cooling is the time-critical intervention",
        "Exertional heat stroke can cause rhabdomyolysis, AKI, liver injury, DIC, and death",
    ]
    case["clinical_red_flags"] = [
        "Altered mental status, seizure, coma, or collapse during heat exposure",
        "Core temperature above 40 C with hypotension, anhidrosis or sweating, or organ injury signs",
    ]
    case["time_critical_actions"] = [
        "Measure rectal temperature or core temperature immediately and monitor with a thermometer",
        "Support airway, oxygen, circulation, and IV fluids with normal saline resuscitation",
        "Activate EMS, critical care transfer, ICU escalation, and organ failure monitoring",
    ]
    case["contraindication_checks"] = [
        "Track rectal temperature and stop cooling at target temperature 38 to 39 C to prevent hypothermia or overcooling",
        "Monitor CK creatine kinase, rhabdomyolysis, AKI, renal function, liver injury, electrolytes, coagulation, and DIC",
        "Avoid antipyretic-centered management because acetaminophen, NSAID, and dantrolene are not recommended for heat stroke",
        "Review dangerous hyperthermia differentials including sepsis, meningitis, malignant hyperthermia, serotonin syndrome, neuroleptic malignant syndrome, and stimulant toxicity",
    ]
    case["clinical_sources"] = [
        {
            "title": "Heatstroke",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/injuries-poisoning/heat-illness/heatstroke",
            "supports": [
                "exertional heat stroke diagnosis and risk stratification",
                "heat stroke is hyperthermia with central nervous system dysfunction",
                "rapid whole-body cooling is the time-critical intervention",
                "exertional heat stroke can cause rhabdomyolysis, AKI, liver injury, DIC, and death",
                "altered mental status, seizure, coma, or collapse during heat exposure as red flags",
                "core temperature above 40 C with hypotension, anhidrosis or sweating, or organ injury signs as severity markers",
                "rectal temperature or core temperature immediately and thermometer monitoring",
                "airway, oxygen, circulation, and IV fluids with normal saline resuscitation",
                "EMS, critical care transfer, ICU escalation, and organ failure monitoring",
                "rectal temperature and stop cooling at target temperature 38 to 39 C to prevent hypothermia or overcooling",
                "CK creatine kinase, rhabdomyolysis, AKI, renal function, liver injury, electrolytes, coagulation, and DIC monitoring",
                "avoid antipyretic-centered management because acetaminophen, NSAID, and dantrolene are not recommended for heat stroke",
                "sepsis, meningitis, malignant hyperthermia, serotonin syndrome, neuroleptic malignant syndrome, and stimulant toxicity dangerous hyperthermia differentials",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "heat stroke time-critical actions must include core or rectal temperature"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_heat_stroke_endpoint_organ_injury_antipyretic_and_differential_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Exertional heat stroke"
    case["patient_demographics"] = {
        "age": 19,
        "sex": "male",
        "weight_kg": 74,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Collapse with confusion during summer training"
    case["history_of_present_illness"] = (
        "Athlete collapses during hot-weather training with altered mental status, "
        "seizure-like activity, hot skin, tachycardia, and suspected core temperature above 40 C."
    )
    case["key_teaching_points"] = [
        "Heat stroke is hyperthermia with central nervous system dysfunction",
        "Rapid whole-body cooling is the time-critical intervention",
        "Exertional heat stroke can cause rhabdomyolysis, AKI, liver injury, DIC, and death",
    ]
    case["clinical_red_flags"] = [
        "Altered mental status, seizure, coma, or collapse during heat exposure",
        "Core temperature above 40 C with hypotension, anhidrosis or sweating, or organ injury signs",
    ]
    case["time_critical_actions"] = [
        "Measure rectal temperature or core temperature immediately and monitor with a thermometer",
        "Start immediate rapid cooling with cold water immersion, ice bath, evaporative cooling, or whole-body cooling",
        "Support airway, oxygen, circulation, and IV fluids with normal saline resuscitation",
        "Activate EMS, critical care transfer, ICU escalation, and organ failure monitoring",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Heatstroke",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/injuries-poisoning/heat-illness/heatstroke",
            "supports": [
                "exertional heat stroke diagnosis and risk stratification",
                "heat stroke is hyperthermia with central nervous system dysfunction",
                "rapid whole-body cooling is the time-critical intervention",
                "exertional heat stroke can cause rhabdomyolysis, AKI, liver injury, DIC, and death",
                "altered mental status, seizure, coma, or collapse during heat exposure as red flags",
                "core temperature above 40 C with hypotension, anhidrosis or sweating, or organ injury signs as severity markers",
                "rectal temperature or core temperature immediately and thermometer monitoring",
                "rapid cooling with cold water immersion, ice bath, evaporative cooling, or whole-body cooling",
                "airway, oxygen, circulation, and IV fluids with normal saline resuscitation",
                "EMS, critical care transfer, ICU escalation, and organ failure monitoring",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "heat stroke safety checks must include cooling endpoint" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_cauda_equina_mri_bladder_neuro_exam_and_spine_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Cauda equina syndrome"
    case["patient_demographics"] = {
        "age": 46,
        "sex": "female",
        "weight_kg": 68,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Severe low back pain with urinary retention"
    case["history_of_present_illness"] = (
        "Patient has acute low back pain radiating to both legs with saddle anesthesia, "
        "new urinary retention, and progressive lower limb weakness concerning for cauda equina."
    )
    case["key_teaching_points"] = [
        "Cauda equina syndrome is a neurologic emergency from lumbosacral nerve root compression",
        "Emergency lumbar MRI and surgical decompression escalation are time-critical",
        "Bowel, bladder, saddle sensory, sexual, or progressive neurologic red flags require urgent action",
    ]
    case["clinical_red_flags"] = [
        "Urinary retention, overflow incontinence, or new bowel dysfunction",
        "Saddle anesthesia, reduced anal tone, bilateral sciatica, or progressive lower limb weakness",
    ]
    case["time_critical_actions"] = [
        "Assess urinary retention with bladder scan and post-void residual PVR",
        "Perform focused neurologic exam including saddle anesthesia, perianal sensation, anal tone, and lower limb weakness",
        "Keep patient in an emergency pathway and do not delay urgent referral",
    ]
    case["contraindication_checks"] = [
        "Document bladder, bowel, saddle anesthesia, sexual dysfunction, and progressive neurologic red flags",
        "Do not delay emergency pathway with outpatient physical therapy or routine low-back-pain discharge",
        "Review spinal infection, epidural abscess, malignancy, tumor, trauma, stenosis, and other compressive causes",
    ]
    case["clinical_sources"] = [
        {
            "title": "Suspected neurological conditions: recognition and referral",
            "organization": "NICE",
            "url": "https://www.nice.org.uk/guidance/ng127",
            "supports": [
                "cauda equina syndrome diagnosis and risk stratification",
                "cauda equina syndrome is a neurologic emergency from lumbosacral nerve root compression",
                "emergency lumbar MRI and surgical decompression escalation are time-critical",
                "bowel, bladder, saddle sensory, sexual, or progressive neurologic red flags require urgent action",
                "urinary retention, overflow incontinence, or new bowel dysfunction as red flags",
                "saddle anesthesia, reduced anal tone, bilateral sciatica, or progressive lower limb weakness as severity markers",
                "urinary retention bladder scan and post-void residual PVR assessment",
                "focused neurologic exam including saddle anesthesia, perianal sensation, anal tone, and lower limb weakness",
                "emergency pathway and do not delay urgent referral",
                "bladder, bowel, saddle anesthesia, sexual dysfunction, and progressive neurologic red flag documentation",
                "avoid delayed outpatient physical therapy or routine low-back-pain discharge",
                "spinal infection, epidural abscess, malignancy, tumor, trauma, stenosis, and other compressive causes",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "cauda equina time-critical actions must include emergency lumbar MRI"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_cauda_equina_red_flags_delay_and_compressive_cause_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Cauda equina syndrome"
    case["patient_demographics"] = {
        "age": 46,
        "sex": "female",
        "weight_kg": 68,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Severe low back pain with urinary retention"
    case["history_of_present_illness"] = (
        "Patient has acute low back pain radiating to both legs with saddle anesthesia, "
        "new urinary retention, and progressive lower limb weakness concerning for cauda equina."
    )
    case["key_teaching_points"] = [
        "Cauda equina syndrome is a neurologic emergency from lumbosacral nerve root compression",
        "Emergency lumbar MRI and surgical decompression escalation are time-critical",
        "Bowel, bladder, saddle sensory, sexual, or progressive neurologic red flags require urgent action",
    ]
    case["clinical_red_flags"] = [
        "Urinary retention, overflow incontinence, or new bowel dysfunction",
        "Saddle anesthesia, reduced anal tone, bilateral sciatica, or progressive lower limb weakness",
    ]
    case["time_critical_actions"] = [
        "Order emergency lumbar MRI immediately for suspected cauda equina",
        "Assess urinary retention with bladder scan and post-void residual PVR",
        "Perform focused neurologic exam including saddle anesthesia, perianal sensation, anal tone, and lower limb weakness",
        "Escalate urgently to neurosurgery or spine surgery for operative decompression planning",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before analgesia",
        "Pregnancy status before imaging when relevant",
    ]
    case["clinical_sources"] = [
        {
            "title": "Suspected neurological conditions: recognition and referral",
            "organization": "NICE",
            "url": "https://www.nice.org.uk/guidance/ng127",
            "supports": [
                "cauda equina syndrome diagnosis and risk stratification",
                "cauda equina syndrome is a neurologic emergency from lumbosacral nerve root compression",
                "emergency lumbar MRI and surgical decompression escalation are time-critical",
                "bowel, bladder, saddle sensory, sexual, or progressive neurologic red flags require urgent action",
                "urinary retention, overflow incontinence, or new bowel dysfunction as red flags",
                "saddle anesthesia, reduced anal tone, bilateral sciatica, or progressive lower limb weakness as severity markers",
                "emergency lumbar MRI immediately for suspected cauda equina",
                "urinary retention bladder scan and post-void residual PVR assessment",
                "focused neurologic exam including saddle anesthesia, perianal sensation, anal tone, and lower limb weakness",
                "urgent neurosurgery or spine surgery escalation for operative decompression planning",
                "medication allergy before analgesia",
                "pregnancy status before imaging when relevant",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "cauda equina safety checks must document bladder" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_acute_limb_ischemia_viability_heparin_and_revascularization():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acute limb ischemia"
    case["patient_demographics"] = {
        "age": 72,
        "sex": "male",
        "weight_kg": 76,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Sudden severe left leg pain and cold foot"
    case["history_of_present_illness"] = (
        "Patient with atrial fibrillation develops abrupt severe leg pain, pallor, "
        "pulseless cold limb, paresthesia, and motor weakness concerning for threatened limb."
    )
    case["key_teaching_points"] = [
        "Acute limb ischemia is a vascular emergency with amputation risk",
        "Rutherford limb viability assessment guides urgency of revascularization",
        "Immediate anticoagulation and urgent vascular surgery escalation are time-critical",
    ]
    case["clinical_red_flags"] = [
        "Sudden pain, pallor, pulselessness, paresthesia, paralysis, or poikilothermia",
        "Motor deficit, sensory deficit, absent Doppler pulse, or threatened limb viability",
    ]
    case["time_critical_actions"] = [
        "Assess 6 Ps, pulses, capillary refill, Doppler signals, motor deficit, sensory deficit, and Rutherford limb viability",
        "Start immediate IV unfractionated heparin infusion and anticoagulation planning if no contraindication",
        "Give analgesia and keep the limb protected while monitoring perfusion",
    ]
    case["contraindication_checks"] = [
        "Review active bleeding, intracranial hemorrhage, platelet count, recent surgery, heparin contraindication, and thrombolysis bleeding risk",
        "Monitor irreversible Rutherford III limb, paralysis, muscle necrosis, compartment syndrome, reperfusion injury, and fasciotomy need",
        "Review atrial fibrillation cardiac embolic source, thrombosis, popliteal aneurysm, trauma, and vascular access causes",
    ]
    case["clinical_sources"] = [
        {
            "title": "Acute Limb Ischemia: An Update on Diagnosis and Management",
            "organization": "National Institutes of Health",
            "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6723825/",
            "supports": [
                "acute limb ischemia diagnosis and risk stratification",
                "acute limb ischemia is a vascular emergency with amputation risk",
                "Rutherford limb viability assessment guides urgency of revascularization",
                "immediate anticoagulation and urgent vascular surgery escalation are time-critical",
                "sudden pain, pallor, pulselessness, paresthesia, paralysis, or poikilothermia as red flags",
                "motor deficit, sensory deficit, absent Doppler pulse, or threatened limb viability as severity markers",
                "6 Ps, pulses, capillary refill, Doppler signals, motor deficit, sensory deficit, and Rutherford limb viability assessment",
                "immediate IV unfractionated heparin infusion and anticoagulation planning if no contraindication",
                "analgesia and limb protection while monitoring perfusion",
                "active bleeding, intracranial hemorrhage, platelet count, recent surgery, heparin contraindication, and thrombolysis bleeding risk",
                "irreversible Rutherford III limb, paralysis, muscle necrosis, compartment syndrome, reperfusion injury, and fasciotomy need",
                "atrial fibrillation cardiac embolic source, thrombosis, popliteal aneurysm, trauma, and vascular access causes",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "acute limb ischemia time-critical actions must include pulse" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_acute_limb_ischemia_bleeding_compartment_and_cause_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acute limb ischemia"
    case["patient_demographics"] = {
        "age": 72,
        "sex": "male",
        "weight_kg": 76,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Sudden severe left leg pain and cold foot"
    case["history_of_present_illness"] = (
        "Patient with atrial fibrillation develops abrupt severe leg pain, pallor, "
        "pulseless cold limb, paresthesia, and motor weakness concerning for threatened limb."
    )
    case["key_teaching_points"] = [
        "Acute limb ischemia is a vascular emergency with amputation risk",
        "Rutherford limb viability assessment guides urgency of revascularization",
        "Immediate anticoagulation and urgent vascular surgery escalation are time-critical",
    ]
    case["clinical_red_flags"] = [
        "Sudden pain, pallor, pulselessness, paresthesia, paralysis, or poikilothermia",
        "Motor deficit, sensory deficit, absent Doppler pulse, or threatened limb viability",
    ]
    case["time_critical_actions"] = [
        "Assess 6 Ps, pulses, capillary refill, Doppler signals, motor deficit, sensory deficit, and Rutherford limb viability",
        "Start immediate IV unfractionated heparin infusion and anticoagulation planning if no contraindication",
        "Escalate urgently to vascular surgery for endovascular revascularization, catheter-directed thrombolysis, thrombectomy, embolectomy, or bypass planning",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before analgesia",
        "Renal function before contrast imaging if the limb is not immediately threatened",
    ]
    case["clinical_sources"] = [
        {
            "title": "Acute Limb Ischemia: An Update on Diagnosis and Management",
            "organization": "National Institutes of Health",
            "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6723825/",
            "supports": [
                "acute limb ischemia diagnosis and risk stratification",
                "acute limb ischemia is a vascular emergency with amputation risk",
                "Rutherford limb viability assessment guides urgency of revascularization",
                "immediate anticoagulation and urgent vascular surgery escalation are time-critical",
                "sudden pain, pallor, pulselessness, paresthesia, paralysis, or poikilothermia as red flags",
                "motor deficit, sensory deficit, absent Doppler pulse, or threatened limb viability as severity markers",
                "6 Ps, pulses, capillary refill, Doppler signals, motor deficit, sensory deficit, and Rutherford limb viability assessment",
                "immediate IV unfractionated heparin infusion and anticoagulation planning if no contraindication",
                "urgent vascular surgery for endovascular revascularization, catheter-directed thrombolysis, thrombectomy, embolectomy, or bypass planning",
                "medication allergy before analgesia",
                "renal function before contrast imaging if the limb is not immediately threatened",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "acute limb ischemia safety checks must include heparin" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_testicular_torsion_assessment_immediate_urology_and_no_delay():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Testicular torsion"
    case["patient_demographics"] = {
        "age": 16,
        "sex": "male",
        "weight_kg": 62,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Sudden severe right testicular pain"
    case["history_of_present_illness"] = (
        "Adolescent has acute scrotal pain with nausea, high-riding testis, "
        "horizontal lie, absent cremasteric reflex, and concern for testicular torsion."
    )
    case["key_teaching_points"] = [
        "Testicular torsion is a surgical emergency with time-sensitive ischemia",
        "High clinical suspicion should trigger immediate urology and surgical exploration",
        "Scrotal ultrasound can help if equivocal but must not delay definitive management",
    ]
    case["clinical_red_flags"] = [
        "Sudden severe unilateral testicular pain with nausea or vomiting",
        "High-riding testis, horizontal lie, absent cremasteric reflex, or reduced Doppler flow",
    ]
    case["time_critical_actions"] = [
        "Assess high clinical suspicion with cremasteric reflex, high-riding testis, horizontal lie, and Doppler or scrotal ultrasound only if equivocal",
        "Keep patient NPO, give analgesia, and document that imaging must not delay immediate management",
    ]
    case["contraindication_checks"] = [
        "Track time from onset because 4 hour to 8 hour ischemia window affects salvage, viability, orchiectomy risk, fertility, and testicular loss",
        "Manual detorsion may be attempted if surgery is not immediately available but is not definitive and must not delay orchiopexy",
        "Plan bilateral orchiopexy or contralateral fixation to prevent recurrence and preserve fertility",
        "Review acute scrotum differentials including epididymitis, torsion of appendage, incarcerated hernia, orchitis, hydrocele, varicocele, and trauma",
    ]
    case["clinical_sources"] = [
        {
            "title": "Testicular Torsion: Diagnosis, Evaluation, and Management",
            "organization": "American Family Physician",
            "url": "https://www.aafp.org/pubs/afp/issues/2013/1215/p835.html",
            "supports": [
                "testicular torsion diagnosis and risk stratification",
                "testicular torsion is a surgical emergency with time-sensitive ischemia",
                "high clinical suspicion should trigger immediate urology and surgical exploration",
                "scrotal ultrasound can help if equivocal but must not delay definitive management",
                "sudden severe unilateral testicular pain with nausea or vomiting as red flags",
                "high-riding testis, horizontal lie, absent cremasteric reflex, or reduced Doppler flow as severity markers",
                "high clinical suspicion with cremasteric reflex, high-riding testis, horizontal lie, and Doppler or scrotal ultrasound only if equivocal",
                "NPO, analgesia, and imaging must not delay immediate management",
                "time from onset because 4 hour to 8 hour ischemia window affects salvage, viability, orchiectomy risk, fertility, and testicular loss",
                "manual detorsion may be attempted if surgery is not immediately available but is not definitive and must not delay orchiopexy",
                "bilateral orchiopexy or contralateral fixation to prevent recurrence and preserve fertility",
                "epididymitis, torsion of appendage, incarcerated hernia, orchitis, hydrocele, varicocele, and trauma acute scrotum differentials",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "testicular torsion time-critical actions must include acute scrotal assessment"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_testicular_torsion_salvage_detorsion_fixation_and_differential_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Testicular torsion"
    case["patient_demographics"] = {
        "age": 16,
        "sex": "male",
        "weight_kg": 62,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Sudden severe right testicular pain"
    case["history_of_present_illness"] = (
        "Adolescent has acute scrotal pain with nausea, high-riding testis, "
        "horizontal lie, absent cremasteric reflex, and concern for testicular torsion."
    )
    case["key_teaching_points"] = [
        "Testicular torsion is a surgical emergency with time-sensitive ischemia",
        "High clinical suspicion should trigger immediate urology and surgical exploration",
        "Scrotal ultrasound can help if equivocal but must not delay definitive management",
    ]
    case["clinical_red_flags"] = [
        "Sudden severe unilateral testicular pain with nausea or vomiting",
        "High-riding testis, horizontal lie, absent cremasteric reflex, or reduced Doppler flow",
    ]
    case["time_critical_actions"] = [
        "Assess high clinical suspicion with cremasteric reflex, high-riding testis, horizontal lie, and Doppler or scrotal ultrasound only if equivocal",
        "Call urology immediately for urgent scrotal exploration, surgical exploration, detorsion, and orchiopexy",
        "Keep patient NPO, give analgesia, and document that imaging must not delay immediate management",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before analgesia",
        "Pregnancy status is not applicable for this male patient",
    ]
    case["clinical_sources"] = [
        {
            "title": "Testicular Torsion: Diagnosis, Evaluation, and Management",
            "organization": "American Family Physician",
            "url": "https://www.aafp.org/pubs/afp/issues/2013/1215/p835.html",
            "supports": [
                "testicular torsion diagnosis and risk stratification",
                "testicular torsion is a surgical emergency with time-sensitive ischemia",
                "high clinical suspicion should trigger immediate urology and surgical exploration",
                "scrotal ultrasound can help if equivocal but must not delay definitive management",
                "sudden severe unilateral testicular pain with nausea or vomiting as red flags",
                "high-riding testis, horizontal lie, absent cremasteric reflex, or reduced Doppler flow as severity markers",
                "high clinical suspicion with cremasteric reflex, high-riding testis, horizontal lie, and Doppler or scrotal ultrasound only if equivocal",
                "immediate urology for urgent scrotal exploration, surgical exploration, detorsion, and orchiopexy",
                "NPO, analgesia, and imaging must not delay immediate management",
                "medication allergy before analgesia",
                "pregnancy status is not applicable for this male patient",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "testicular torsion safety checks must include ischemia" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_ovarian_torsion_hcg_ultrasound_and_surgical_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Adnexal torsion"
    case["patient_demographics"] = {
        "age": 17,
        "sex": "female",
        "weight_kg": 58,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Sudden severe right pelvic pain with vomiting"
    case["history_of_present_illness"] = (
        "Adolescent has intermittent unilateral pelvic pain, nausea, vomiting, "
        "right adnexal tenderness, and suspected ovarian torsion."
    )
    case["key_teaching_points"] = [
        "Adnexal torsion is a surgical emergency threatening ovarian function and fertility",
        "Doppler flow alone cannot confirm or exclude torsion",
        "Timely diagnostic laparoscopy and detorsion preserve ovarian function",
    ]
    case["clinical_red_flags"] = [
        "Sudden unilateral pelvic pain with nausea or vomiting",
        "Adnexal mass, enlarged ovary, abnormal Doppler flow, or persistent high clinical suspicion",
    ]
    case["time_critical_actions"] = [
        "Obtain pregnancy test and quantitative hCG immediately",
        "Order pelvic ultrasound or transvaginal ultrasound with Doppler assessment",
        "Give analgesia and antiemetic support while keeping the patient NPO",
    ]
    case["contraindication_checks"] = [
        "Normal Doppler flow does not rule out torsion and imaging must not delay timely intervention",
        "Plan ovarian preservation with detorsion, cystectomy when appropriate, fertility protection, and oophorectomy only if unavoidable",
        "Review ectopic pregnancy, appendicitis, PID, ruptured ovarian cyst, hemorrhagic cyst, tubo-ovarian abscess, and other acute pelvic pain differentials",
    ]
    case["clinical_sources"] = [
        {
            "title": "Ovarian Torsion",
            "organization": "National Institutes of Health",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK560675/",
            "supports": [
                "adnexal torsion diagnosis and risk stratification",
                "adnexal torsion is a surgical emergency threatening ovarian function and fertility",
                "Doppler flow alone cannot confirm or exclude torsion",
                "timely diagnostic laparoscopy and detorsion preserve ovarian function",
                "sudden unilateral pelvic pain with nausea or vomiting as red flags",
                "adnexal mass, enlarged ovary, abnormal Doppler flow, or persistent high clinical suspicion as severity markers",
                "pregnancy test and quantitative hCG immediately",
                "pelvic ultrasound or transvaginal ultrasound with Doppler assessment",
                "analgesia and antiemetic support while keeping the patient NPO",
                "normal Doppler flow does not rule out torsion and imaging must not delay timely intervention",
                "ovarian preservation with detorsion, cystectomy, fertility protection, and oophorectomy only if unavoidable",
                "ectopic pregnancy, appendicitis, PID, ruptured ovarian cyst, hemorrhagic cyst, tubo-ovarian abscess, and acute pelvic pain differentials",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "ovarian or adnexal torsion time-critical actions must include pregnancy testing"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_ovarian_torsion_doppler_preservation_and_differential_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Adnexal torsion"
    case["patient_demographics"] = {
        "age": 17,
        "sex": "female",
        "weight_kg": 58,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Sudden severe right pelvic pain with vomiting"
    case["history_of_present_illness"] = (
        "Adolescent has intermittent unilateral pelvic pain, nausea, vomiting, "
        "right adnexal tenderness, and suspected ovarian torsion."
    )
    case["key_teaching_points"] = [
        "Adnexal torsion is a surgical emergency threatening ovarian function and fertility",
        "Doppler flow alone cannot confirm or exclude torsion",
        "Timely diagnostic laparoscopy and detorsion preserve ovarian function",
    ]
    case["clinical_red_flags"] = [
        "Sudden unilateral pelvic pain with nausea or vomiting",
        "Adnexal mass, enlarged ovary, abnormal Doppler flow, or persistent high clinical suspicion",
    ]
    case["time_critical_actions"] = [
        "Obtain pregnancy test and quantitative hCG immediately",
        "Order pelvic ultrasound or transvaginal ultrasound with Doppler assessment",
        "Escalate urgently to OB/GYN for diagnostic laparoscopy, detorsion, and surgical evaluation",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before analgesia",
        "Renal function before contrast CT if alternative diagnosis requires imaging",
    ]
    case["clinical_sources"] = [
        {
            "title": "Ovarian Torsion",
            "organization": "National Institutes of Health",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK560675/",
            "supports": [
                "adnexal torsion diagnosis and risk stratification",
                "adnexal torsion is a surgical emergency threatening ovarian function and fertility",
                "Doppler flow alone cannot confirm or exclude torsion",
                "timely diagnostic laparoscopy and detorsion preserve ovarian function",
                "sudden unilateral pelvic pain with nausea or vomiting as red flags",
                "adnexal mass, enlarged ovary, abnormal Doppler flow, or persistent high clinical suspicion as severity markers",
                "pregnancy test and quantitative hCG immediately",
                "pelvic ultrasound or transvaginal ultrasound with Doppler assessment",
                "urgent OB/GYN diagnostic laparoscopy, detorsion, and surgical evaluation",
                "medication allergy before analgesia",
                "renal function before contrast CT if alternative diagnosis requires imaging",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "ovarian or adnexal torsion safety checks must include normal Doppler flow"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_spinal_epidural_abscess_mri_cultures_antibiotics_and_surgical_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Spinal epidural abscess"
    case["patient_demographics"] = {
        "age": 54,
        "sex": "male",
        "weight_kg": 82,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Severe back pain with fever and new leg weakness"
    case["history_of_present_illness"] = (
        "Patient with diabetes and recent bacteremia has worsening atraumatic back pain, "
        "fever, focal spine tenderness, urinary retention, and new bilateral leg weakness "
        "concerning for spinal epidural abscess."
    )
    case["key_teaching_points"] = [
        "Spinal epidural abscess is an infectious spinal cord compression emergency",
        "MRI spine is the preferred urgent diagnostic test",
        "Cultures, empiric antibiotics, and surgical source control planning prevent neurologic injury",
    ]
    case["clinical_red_flags"] = [
        "Back pain with fever, bacteremia, diabetes, IVDU, recent spinal procedure, or immunosuppression",
        "New weakness, sensory change, bowel or bladder dysfunction, sepsis, or progressive neurologic deficit",
    ]
    case["time_critical_actions"] = [
        "Order emergency contrast MRI spine or whole spine MRI immediately",
        "Obtain blood cultures, ESR, CRP, and source cultures before antibiotics when feasible",
        "Start empiric IV vancomycin plus cefepime or ceftriaxone antibiotics after cultures if neurologic compromise or sepsis is present",
    ]
    case["contraindication_checks"] = [
        "Perform serial neurologic exams for weakness, paralysis, sensory deficit, bowel or bladder dysfunction, and sepsis monitoring",
        "Review bacteremia, endocarditis, diabetes, IVDU, immunosuppression, recent spinal procedure, staphylococcus risk, and infection source",
        "Obtain blood culture before antibiotics when feasible, plan biopsy if stable, and do not delay empiric antibiotics for unstable patient or neurologic compromise",
    ]
    case["clinical_sources"] = [
        {
            "title": "Spinal Epidural Abscess",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/neurologic-disorders/spinal-cord-disorders/spinal-epidural-abscess",
            "supports": [
                "spinal epidural abscess diagnosis and risk stratification",
                "spinal epidural abscess is an infectious spinal cord compression emergency",
                "MRI spine is the preferred urgent diagnostic test",
                "cultures, empiric antibiotics, and surgical source control planning prevent neurologic injury",
                "back pain with fever, bacteremia, diabetes, IVDU, recent spinal procedure, or immunosuppression as red flags",
                "new weakness, sensory change, bowel or bladder dysfunction, sepsis, or progressive neurologic deficit as severity markers",
                "emergency contrast MRI spine or whole spine MRI immediately",
                "blood cultures, ESR, CRP, and source cultures before antibiotics when feasible",
                "empiric IV vancomycin plus cefepime or ceftriaxone antibiotics after cultures if neurologic compromise or sepsis is present",
                "serial neurologic exams for weakness, paralysis, sensory deficit, bowel or bladder dysfunction, and sepsis monitoring",
                "bacteremia, endocarditis, diabetes, IVDU, immunosuppression, recent spinal procedure, staphylococcus risk, and infection source",
                "blood culture before antibiotics when feasible, biopsy if stable, and do not delay empiric antibiotics for unstable patient or neurologic compromise",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "spinal epidural abscess time-critical actions must include urgent MRI"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_spinal_epidural_abscess_neuro_risk_and_antibiotic_timing_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Spinal epidural abscess"
    case["patient_demographics"] = {
        "age": 54,
        "sex": "male",
        "weight_kg": 82,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Severe back pain with fever and new leg weakness"
    case["history_of_present_illness"] = (
        "Patient with diabetes and recent bacteremia has worsening atraumatic back pain, "
        "fever, focal spine tenderness, urinary retention, and new bilateral leg weakness "
        "concerning for spinal epidural abscess."
    )
    case["key_teaching_points"] = [
        "Spinal epidural abscess is an infectious spinal cord compression emergency",
        "MRI spine is the preferred urgent diagnostic test",
        "Cultures, empiric antibiotics, and surgical source control planning prevent neurologic injury",
    ]
    case["clinical_red_flags"] = [
        "Back pain with fever, bacteremia, diabetes, IVDU, recent spinal procedure, or immunosuppression",
        "New weakness, sensory change, bowel or bladder dysfunction, sepsis, or progressive neurologic deficit",
    ]
    case["time_critical_actions"] = [
        "Order emergency contrast MRI spine or whole spine MRI immediately",
        "Obtain blood cultures, ESR, CRP, and source cultures before antibiotics when feasible",
        "Start empiric IV vancomycin plus cefepime or ceftriaxone antibiotics after cultures if neurologic compromise or sepsis is present",
        "Escalate immediately to neurosurgery or spine surgery for decompression, drainage, and source control planning",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antibiotic selection",
        "Renal dosing before vancomycin and cefepime",
    ]
    case["clinical_sources"] = [
        {
            "title": "Spinal Epidural Abscess",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/neurologic-disorders/spinal-cord-disorders/spinal-epidural-abscess",
            "supports": [
                "spinal epidural abscess diagnosis and risk stratification",
                "spinal epidural abscess is an infectious spinal cord compression emergency",
                "MRI spine is the preferred urgent diagnostic test",
                "cultures, empiric antibiotics, and surgical source control planning prevent neurologic injury",
                "back pain with fever, bacteremia, diabetes, IVDU, recent spinal procedure, or immunosuppression as red flags",
                "new weakness, sensory change, bowel or bladder dysfunction, sepsis, or progressive neurologic deficit as severity markers",
                "emergency contrast MRI spine or whole spine MRI immediately",
                "blood cultures, ESR, CRP, and source cultures before antibiotics when feasible",
                "empiric IV vancomycin plus cefepime or ceftriaxone antibiotics after cultures if neurologic compromise or sepsis is present",
                "immediate neurosurgery or spine surgery for decompression, drainage, and source control planning",
                "medication allergy before antibiotic selection",
                "renal dosing before vancomycin and cefepime",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "spinal epidural abscess safety checks must include neurologic deficit"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_upper_gi_bleed_resuscitation_labs_endoscopy_and_medical_therapy():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Upper GI bleeding with possible variceal hemorrhage"
    case["patient_demographics"] = {
        "age": 63,
        "sex": "male",
        "weight_kg": 74,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Large-volume hematemesis and melena"
    case["history_of_present_illness"] = (
        "Patient with cirrhosis and warfarin use presents with coffee ground emesis, "
        "large-volume hematemesis, melena, tachycardia, hypotension, and suspected "
        "upper GI bleed from peptic ulcer or variceal bleeding."
    )
    case["key_teaching_points"] = [
        "Upper GI bleeding requires hemodynamic resuscitation before endoscopy",
        "Early endoscopy within 24 hours is recommended after resuscitation for admitted upper GI bleeding",
        "Suspected variceal bleeding needs vasoactive therapy such as octreotide plus antibiotic prophylaxis",
    ]
    case["clinical_red_flags"] = [
        "Hematemesis, melena, syncope, shock, hypotension, tachycardia, or ongoing transfusion requirement",
        "Cirrhosis, portal hypertension, anticoagulant use, coagulopathy, or active vomiting blood",
    ]
    case["time_critical_actions"] = [
        "Establish two large-bore IV access lines and start hemodynamic resuscitation for shock with massive transfusion planning",
        "Send CBC, hemoglobin, INR, type and screen, crossmatch, and prepare PRBC with restrictive transfusion strategy",
    ]
    case["contraindication_checks"] = [
        "Assess airway aspiration risk from active hematemesis, vomiting blood, altered mental status, and intubation need before endoscopy",
        "Review anticoagulant, warfarin, DOAC, antiplatelet, INR, platelet, coagulopathy, and reversal needs",
        "For cirrhosis and portal hypertension, plan variceal rescue options including TIPS, balloon tamponade, stent, or rescue therapy",
        "Monitor for rebleeding, unstable shock, repeat endoscopy need, ICU disposition, and risk stratification",
    ]
    case["clinical_sources"] = [
        {
            "title": "ACG Clinical Guideline: Upper Gastrointestinal and Ulcer Bleeding",
            "organization": "American College of Gastroenterology",
            "url": "https://journals.lww.com/ajg/fulltext/2021/05000/acg_clinical_guideline__upper_gastrointestinal_and.14.aspx",
            "supports": [
                "upper GI bleeding diagnosis and risk stratification",
                "upper GI bleeding requires hemodynamic resuscitation before endoscopy",
                "early endoscopy within 24 hours is recommended after resuscitation for admitted upper GI bleeding",
                "suspected variceal bleeding needs vasoactive therapy such as octreotide plus antibiotic prophylaxis",
                "hematemesis, melena, syncope, shock, hypotension, tachycardia, or ongoing transfusion requirement as red flags",
                "cirrhosis, portal hypertension, anticoagulant use, coagulopathy, or active vomiting blood as severity markers",
                "two large-bore IV access lines and hemodynamic resuscitation for shock with massive transfusion planning",
                "CBC, hemoglobin, INR, type and screen, crossmatch, PRBC, and restrictive transfusion strategy",
                "airway aspiration risk from active hematemesis, vomiting blood, altered mental status, and intubation need before endoscopy",
                "anticoagulant, warfarin, DOAC, antiplatelet, INR, platelet, coagulopathy, and reversal needs",
                "cirrhosis and portal hypertension variceal rescue options including TIPS, balloon tamponade, stent, or rescue therapy",
                "rebleeding, unstable shock, repeat endoscopy need, ICU disposition, and risk stratification monitoring",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "upper GI bleeding time-critical actions must include hemodynamic resuscitation"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_upper_gi_bleed_airway_reversal_variceal_and_rebleed_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Upper GI bleeding with possible variceal hemorrhage"
    case["patient_demographics"] = {
        "age": 63,
        "sex": "male",
        "weight_kg": 74,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Large-volume hematemesis and melena"
    case["history_of_present_illness"] = (
        "Patient with cirrhosis and warfarin use presents with coffee ground emesis, "
        "large-volume hematemesis, melena, tachycardia, hypotension, and suspected "
        "upper GI bleed from peptic ulcer or variceal bleeding."
    )
    case["key_teaching_points"] = [
        "Upper GI bleeding requires hemodynamic resuscitation before endoscopy",
        "Early endoscopy within 24 hours is recommended after resuscitation for admitted upper GI bleeding",
        "Suspected variceal bleeding needs vasoactive therapy such as octreotide plus antibiotic prophylaxis",
    ]
    case["clinical_red_flags"] = [
        "Hematemesis, melena, syncope, shock, hypotension, tachycardia, or ongoing transfusion requirement",
        "Cirrhosis, portal hypertension, anticoagulant use, coagulopathy, or active vomiting blood",
    ]
    case["time_critical_actions"] = [
        "Establish two large-bore IV access lines and start hemodynamic resuscitation for shock with massive transfusion planning",
        "Send CBC, hemoglobin, INR, type and screen, crossmatch, and prepare PRBC with restrictive transfusion strategy",
        "Call gastroenterology for early endoscopy, EGD, and endoscopic hemostasis within 24 hours after resuscitation",
        "Start PPI proton pump inhibitor and, if variceal bleeding is suspected, octreotide vasoactive therapy plus ceftriaxone antibiotic prophylaxis",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Renal dosing before contrast imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "ACG Clinical Guideline: Upper Gastrointestinal and Ulcer Bleeding",
            "organization": "American College of Gastroenterology",
            "url": "https://journals.lww.com/ajg/fulltext/2021/05000/acg_clinical_guideline__upper_gastrointestinal_and.14.aspx",
            "supports": [
                "upper GI bleeding diagnosis and risk stratification",
                "upper GI bleeding requires hemodynamic resuscitation before endoscopy",
                "early endoscopy within 24 hours is recommended after resuscitation for admitted upper GI bleeding",
                "suspected variceal bleeding needs vasoactive therapy such as octreotide plus antibiotic prophylaxis",
                "hematemesis, melena, syncope, shock, hypotension, tachycardia, or ongoing transfusion requirement as red flags",
                "cirrhosis, portal hypertension, anticoagulant use, coagulopathy, or active vomiting blood as severity markers",
                "two large-bore IV access lines and hemodynamic resuscitation for shock with massive transfusion planning",
                "CBC, hemoglobin, INR, type and screen, crossmatch, PRBC, and restrictive transfusion strategy",
                "gastroenterology for early endoscopy, EGD, and endoscopic hemostasis within 24 hours after resuscitation",
                "PPI proton pump inhibitor and variceal bleeding octreotide vasoactive therapy plus ceftriaxone antibiotic prophylaxis",
                "medication allergy before antiemetics",
                "renal dosing before contrast imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "upper GI bleeding safety checks must include airway" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_acute_mesenteric_ischemia_cta_resuscitation_antibiotics_and_surgery():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acute mesenteric ischemia"
    case["patient_demographics"] = {
        "age": 78,
        "sex": "female",
        "weight_kg": 61,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Severe abdominal pain out of proportion to exam"
    case["history_of_present_illness"] = (
        "Older patient with atrial fibrillation has abrupt severe abdominal pain, "
        "vomiting, minimal early tenderness, metabolic acidosis, lactate elevation, "
        "and concern for acute mesenteric ischemia from SMA embolus."
    )
    case["key_teaching_points"] = [
        "Acute mesenteric ischemia is a surgical and vascular emergency",
        "CTA should be obtained urgently when AMI is suspected",
        "Resuscitation, broad-spectrum antibiotics, anticoagulation, and revascularization planning are time-critical",
    ]
    case["clinical_red_flags"] = [
        "Pain out of proportion, vomiting, atrial fibrillation, shock, metabolic acidosis, or rising lactate",
        "Peritonitis, GI bleeding, organ failure, or suspected bowel infarction",
    ]
    case["time_critical_actions"] = [
        "Order CTA abdomen pelvis or CT angiography immediately for suspected mesenteric ischemia",
        "Begin fluid resuscitation and monitor lactate, metabolic acidosis, shock, and organ perfusion",
        "Start early broad-spectrum antibiotics such as piperacillin tazobactam for bowel ischemia",
    ]
    case["contraindication_checks"] = [
        "Review heparin anticoagulation plan with bleeding, platelet, intracranial hemorrhage, and recent surgery contraindications",
        "Assess bowel viability, necrotic bowel, peritonitis, damage control laparotomy, second look operation, and short bowel risk",
        "Review embolic atrial fibrillation source, SMA thrombosis, venous thrombosis, low-flow shock, and nonocclusive mesenteric ischemia causes",
        "Do not delay CTA or intervention because normal lactate does not rule out AMI and pain out of proportion remains high risk",
    ]
    case["clinical_sources"] = [
        {
            "title": "Acute mesenteric ischemia: updated guidelines of the World Society of Emergency Surgery",
            "organization": "World Journal of Emergency Surgery",
            "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC9580452/",
            "supports": [
                "acute mesenteric ischemia diagnosis and risk stratification",
                "acute mesenteric ischemia is a surgical and vascular emergency",
                "CTA should be obtained urgently when AMI is suspected",
                "resuscitation, broad-spectrum antibiotics, anticoagulation, and revascularization planning are time-critical",
                "pain out of proportion, vomiting, atrial fibrillation, shock, metabolic acidosis, or rising lactate as red flags",
                "peritonitis, GI bleeding, organ failure, or suspected bowel infarction as severity markers",
                "CTA abdomen pelvis or CT angiography immediately for suspected mesenteric ischemia",
                "fluid resuscitation and lactate, metabolic acidosis, shock, and organ perfusion monitoring",
                "early broad-spectrum antibiotics such as piperacillin tazobactam for bowel ischemia",
                "heparin anticoagulation plan with bleeding, platelet, intracranial hemorrhage, and recent surgery contraindications",
                "bowel viability, necrotic bowel, peritonitis, damage control laparotomy, second look operation, and short bowel risk",
                "embolic atrial fibrillation source, SMA thrombosis, venous thrombosis, low-flow shock, and nonocclusive mesenteric ischemia causes",
                "do not delay CTA or intervention because normal lactate does not rule out AMI and pain out of proportion remains high risk",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "acute mesenteric ischemia time-critical actions must include CTA"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_acute_mesenteric_ischemia_anticoagulation_viability_cause_and_lactate_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Acute mesenteric ischemia"
    case["patient_demographics"] = {
        "age": 78,
        "sex": "female",
        "weight_kg": 61,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Severe abdominal pain out of proportion to exam"
    case["history_of_present_illness"] = (
        "Older patient with atrial fibrillation has abrupt severe abdominal pain, "
        "vomiting, minimal early tenderness, metabolic acidosis, lactate elevation, "
        "and concern for acute mesenteric ischemia from SMA embolus."
    )
    case["key_teaching_points"] = [
        "Acute mesenteric ischemia is a surgical and vascular emergency",
        "CTA should be obtained urgently when AMI is suspected",
        "Resuscitation, broad-spectrum antibiotics, anticoagulation, and revascularization planning are time-critical",
    ]
    case["clinical_red_flags"] = [
        "Pain out of proportion, vomiting, atrial fibrillation, shock, metabolic acidosis, or rising lactate",
        "Peritonitis, GI bleeding, organ failure, or suspected bowel infarction",
    ]
    case["time_critical_actions"] = [
        "Order CTA abdomen pelvis or CT angiography immediately for suspected mesenteric ischemia",
        "Begin fluid resuscitation and monitor lactate, metabolic acidosis, shock, and organ perfusion",
        "Start early broad-spectrum antibiotics such as piperacillin tazobactam for bowel ischemia",
        "Escalate urgently to acute care surgery and vascular surgery for endovascular revascularization, embolectomy, exploratory laparotomy, and bowel resection planning",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antibiotics",
        "Creatinine and renal function before contrast imaging if this does not delay CTA",
    ]
    case["clinical_sources"] = [
        {
            "title": "Acute mesenteric ischemia: updated guidelines of the World Society of Emergency Surgery",
            "organization": "World Journal of Emergency Surgery",
            "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC9580452/",
            "supports": [
                "acute mesenteric ischemia diagnosis and risk stratification",
                "acute mesenteric ischemia is a surgical and vascular emergency",
                "CTA should be obtained urgently when AMI is suspected",
                "resuscitation, broad-spectrum antibiotics, anticoagulation, and revascularization planning are time-critical",
                "pain out of proportion, vomiting, atrial fibrillation, shock, metabolic acidosis, or rising lactate as red flags",
                "peritonitis, GI bleeding, organ failure, or suspected bowel infarction as severity markers",
                "CTA abdomen pelvis or CT angiography immediately for suspected mesenteric ischemia",
                "fluid resuscitation and lactate, metabolic acidosis, shock, and organ perfusion monitoring",
                "early broad-spectrum antibiotics such as piperacillin tazobactam for bowel ischemia",
                "acute care surgery and vascular surgery for endovascular revascularization, embolectomy, exploratory laparotomy, and bowel resection planning",
                "medication allergy before antibiotics",
                "creatinine and renal function before contrast imaging if this does not delay CTA",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "acute mesenteric ischemia safety checks must include heparin" in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_necrotizing_soft_tissue_infection_surgery_antibiotics_resuscitation_and_no_delay():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Necrotizing fasciitis"
    case["patient_demographics"] = {
        "age": 63,
        "sex": "female",
        "weight_kg": 72,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Rapidly worsening leg pain with fever and skin discoloration"
    case["history_of_present_illness"] = (
        "Patient with diabetes has severe pain out of proportion, rapidly spreading erythema, "
        "bullae, ecchymosis, crepitus, hypotension, lactate elevation, and concern for "
        "necrotizing soft tissue infection."
    )
    case["key_teaching_points"] = [
        "Necrotizing soft tissue infection is a surgical emergency",
        "Broad-spectrum antibiotics and shock resuscitation must accompany urgent source control",
        "Imaging or laboratory scoring must not delay surgical exploration",
    ]
    case["clinical_red_flags"] = [
        "Pain out of proportion, rapidly progressive erythema, bullae, ecchymosis, crepitus, or skin necrosis",
        "Fever, shock, lactate elevation, organ failure, diabetes, immunocompromise, or severe toxicity",
    ]
    case["time_critical_actions"] = [
        "Start broad-spectrum empiric antibiotics with vancomycin plus piperacillin tazobactam and clindamycin",
        "Begin sepsis shock resuscitation with fluids, lactate monitoring, ICU escalation, vasopressors, and organ support",
        "Document that CT imaging or LRINEC labs must not delay immediate source control",
    ]
    case["contraindication_checks"] = [
        "Include toxin suppression with clindamycin or linezolid for group A strep, streptococcal NSTI, or gas gangrene concern",
        "Plan repeat debridement, second look, or 24 to 48 hour source control reassessment until infection is controlled",
        "Do not let LRINEC, imaging, CT, or diagnostic testing exclude NSTI or delay surgical exploration",
        "Monitor shock, AKI renal injury, coagulopathy, organ failure, amputation risk, diabetes, and immunocompromised risk",
    ]
    case["clinical_sources"] = [
        {
            "title": "Clinical Guidance for Type II Necrotizing Fasciitis",
            "organization": "CDC",
            "url": "https://www.cdc.gov/group-a-strep/hcp/clinical-guidance/necrotizing-fasciitis.html",
            "supports": [
                "necrotizing fasciitis diagnosis and risk stratification",
                "necrotizing soft tissue infection is a surgical emergency",
                "broad-spectrum antibiotics and shock resuscitation must accompany urgent source control",
                "imaging or laboratory scoring must not delay surgical exploration",
                "pain out of proportion, rapidly progressive erythema, bullae, ecchymosis, crepitus, or skin necrosis as red flags",
                "fever, shock, lactate elevation, organ failure, diabetes, immunocompromise, or severe toxicity as severity markers",
                "broad-spectrum empiric antibiotics with vancomycin plus piperacillin tazobactam and clindamycin",
                "sepsis shock resuscitation with fluids, lactate monitoring, ICU escalation, vasopressors, and organ support",
                "CT imaging or LRINEC labs must not delay immediate source control",
                "toxin suppression with clindamycin or linezolid for group A strep, streptococcal NSTI, or gas gangrene concern",
                "repeat debridement, second look, or 24 to 48 hour source control reassessment until infection is controlled",
                "LRINEC, imaging, CT, or diagnostic testing should not exclude NSTI or delay surgical exploration",
                "shock, AKI renal injury, coagulopathy, organ failure, amputation risk, diabetes, and immunocompromised risk monitoring",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "necrotizing soft tissue infection time-critical actions must include urgent surgical exploration"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_necrotizing_soft_tissue_infection_toxin_repeat_debridement_diagnostic_and_organ_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Necrotizing fasciitis"
    case["patient_demographics"] = {
        "age": 63,
        "sex": "female",
        "weight_kg": 72,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Rapidly worsening leg pain with fever and skin discoloration"
    case["history_of_present_illness"] = (
        "Patient with diabetes has severe pain out of proportion, rapidly spreading erythema, "
        "bullae, ecchymosis, crepitus, hypotension, lactate elevation, and concern for "
        "necrotizing soft tissue infection."
    )
    case["key_teaching_points"] = [
        "Necrotizing soft tissue infection is a surgical emergency",
        "Broad-spectrum antibiotics and shock resuscitation must accompany urgent source control",
        "Imaging or laboratory scoring must not delay surgical exploration",
    ]
    case["clinical_red_flags"] = [
        "Pain out of proportion, rapidly progressive erythema, bullae, ecchymosis, crepitus, or skin necrosis",
        "Fever, shock, lactate elevation, organ failure, diabetes, immunocompromise, or severe toxicity",
    ]
    case["time_critical_actions"] = [
        "Call surgery urgently for immediate surgical exploration, operative debridement, fasciotomy, and source control",
        "Start broad-spectrum empiric antibiotics with vancomycin plus piperacillin tazobactam and clindamycin",
        "Begin sepsis shock resuscitation with fluids, lactate monitoring, ICU escalation, vasopressors, and organ support",
        "Document that CT imaging or LRINEC labs must not delay immediate source control",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antibiotic selection",
        "Renal dosing before vancomycin and piperacillin tazobactam",
    ]
    case["clinical_sources"] = [
        {
            "title": "Clinical Guidance for Type II Necrotizing Fasciitis",
            "organization": "CDC",
            "url": "https://www.cdc.gov/group-a-strep/hcp/clinical-guidance/necrotizing-fasciitis.html",
            "supports": [
                "necrotizing fasciitis diagnosis and risk stratification",
                "necrotizing soft tissue infection is a surgical emergency",
                "broad-spectrum antibiotics and shock resuscitation must accompany urgent source control",
                "imaging or laboratory scoring must not delay surgical exploration",
                "pain out of proportion, rapidly progressive erythema, bullae, ecchymosis, crepitus, or skin necrosis as red flags",
                "fever, shock, lactate elevation, organ failure, diabetes, immunocompromise, or severe toxicity as severity markers",
                "immediate surgical exploration, operative debridement, fasciotomy, and source control",
                "broad-spectrum empiric antibiotics with vancomycin plus piperacillin tazobactam and clindamycin",
                "sepsis shock resuscitation with fluids, lactate monitoring, ICU escalation, vasopressors, and organ support",
                "CT imaging or LRINEC labs must not delay immediate source control",
                "medication allergy before antibiotic selection",
                "renal dosing before vancomycin and piperacillin tazobactam",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "necrotizing soft tissue infection safety checks must include clindamycin"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_ruptured_aaa_vascular_repair_resuscitation_blood_and_imaging_strategy():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Ruptured abdominal aortic aneurysm"
    case["patient_demographics"] = {
        "age": 74,
        "sex": "male",
        "weight_kg": 79,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Severe abdominal and back pain with syncope"
    case["history_of_present_illness"] = (
        "Older smoker has abrupt abdominal pain radiating to the back, syncope, hypotension, "
        "tachycardia, and a pulsatile abdominal mass concerning for ruptured abdominal aortic aneurysm."
    )
    case["key_teaching_points"] = [
        "Ruptured abdominal aortic aneurysm is a vascular surgical emergency",
        "Unstable patients need immediate repair planning without imaging delay",
        "Controlled resuscitation, blood products, and vascular team activation are time-critical",
    ]
    case["clinical_red_flags"] = [
        "Abdominal or back pain, syncope, hypotension, shock, or pulsatile abdominal mass",
        "Known abdominal aortic aneurysm, elderly smoker, collapse, or retroperitoneal hemorrhage signs",
    ]
    case["time_critical_actions"] = [
        "Use permissive hypotension with controlled restrictive fluid resuscitation and target systolic blood pressure while mental status is preserved",
        "Place large-bore IV access, send type and crossmatch, prepare blood products, PRBCs, and massive transfusion protocol",
        "Use bedside ultrasound or CTA only if stable and document that imaging must not delay care for an unstable patient",
    ]
    case["contraindication_checks"] = [
        "Do not delay transfer, immediate repair, or urgent vascular intervention for unstable suspected ruptured AAA",
        "Avoid anticoagulation, antiplatelet escalation, or thrombolysis until hemorrhage and bleeding risk are addressed",
        "Monitor shock, coagulopathy, hypothermia, renal injury, cardiac arrest, abdominal compartment syndrome, and lethal triad",
    ]
    case["clinical_sources"] = [
        {
            "title": "Abdominal aortic aneurysm: diagnosis and management",
            "organization": "NICE",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK556921/",
            "supports": [
                "ruptured abdominal aortic aneurysm diagnosis and risk stratification",
                "ruptured abdominal aortic aneurysm is a vascular surgical emergency",
                "unstable patients need immediate repair planning without imaging delay",
                "controlled resuscitation, blood products, and vascular team activation are time-critical",
                "abdominal or back pain, syncope, hypotension, shock, or pulsatile abdominal mass as red flags",
                "known abdominal aortic aneurysm, elderly smoker, collapse, or retroperitoneal hemorrhage signs as severity markers",
                "permissive hypotension with controlled restrictive fluid resuscitation and target systolic blood pressure",
                "large-bore IV access, type and crossmatch, blood products, PRBCs, and massive transfusion protocol",
                "bedside ultrasound or CTA only if stable and imaging must not delay care for an unstable patient",
                "do not delay transfer, immediate repair, or urgent vascular intervention for unstable suspected ruptured AAA",
                "avoid anticoagulation, antiplatelet escalation, or thrombolysis until hemorrhage and bleeding risk are addressed",
                "shock, coagulopathy, hypothermia, renal injury, cardiac arrest, abdominal compartment syndrome, and lethal triad monitoring",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "ruptured or symptomatic abdominal aortic aneurysm time-critical actions must include immediate vascular surgery"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_ruptured_aaa_delay_antithrombotic_and_shock_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Ruptured abdominal aortic aneurysm"
    case["patient_demographics"] = {
        "age": 74,
        "sex": "male",
        "weight_kg": 79,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Severe abdominal and back pain with syncope"
    case["history_of_present_illness"] = (
        "Older smoker has abrupt abdominal pain radiating to the back, syncope, hypotension, "
        "tachycardia, and a pulsatile abdominal mass concerning for ruptured abdominal aortic aneurysm."
    )
    case["key_teaching_points"] = [
        "Ruptured abdominal aortic aneurysm is a vascular surgical emergency",
        "Unstable patients need immediate repair planning without imaging delay",
        "Controlled resuscitation, blood products, and vascular team activation are time-critical",
    ]
    case["clinical_red_flags"] = [
        "Abdominal or back pain, syncope, hypotension, shock, or pulsatile abdominal mass",
        "Known abdominal aortic aneurysm, elderly smoker, collapse, or retroperitoneal hemorrhage signs",
    ]
    case["time_critical_actions"] = [
        "Activate vascular surgery immediately for EVAR, open repair, or operative aneurysm repair planning",
        "Use permissive hypotension with controlled restrictive fluid resuscitation and target systolic blood pressure while mental status is preserved",
        "Place large-bore IV access, send type and crossmatch, prepare blood products, PRBCs, and massive transfusion protocol",
        "Use bedside ultrasound or CTA only if stable and document that imaging must not delay care for an unstable patient",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before analgesia",
        "Renal function before contrast imaging if this does not delay repair",
    ]
    case["clinical_sources"] = [
        {
            "title": "Abdominal aortic aneurysm: diagnosis and management",
            "organization": "NICE",
            "url": "https://www.ncbi.nlm.nih.gov/books/NBK556921/",
            "supports": [
                "ruptured abdominal aortic aneurysm diagnosis and risk stratification",
                "ruptured abdominal aortic aneurysm is a vascular surgical emergency",
                "unstable patients need immediate repair planning without imaging delay",
                "controlled resuscitation, blood products, and vascular team activation are time-critical",
                "abdominal or back pain, syncope, hypotension, shock, or pulsatile abdominal mass as red flags",
                "known abdominal aortic aneurysm, elderly smoker, collapse, or retroperitoneal hemorrhage signs as severity markers",
                "immediate vascular surgery for EVAR, open repair, or operative aneurysm repair planning",
                "permissive hypotension with controlled restrictive fluid resuscitation and target systolic blood pressure",
                "large-bore IV access, type and crossmatch, blood products, PRBCs, and massive transfusion protocol",
                "bedside ultrasound or CTA only if stable and imaging must not delay care for an unstable patient",
                "medication allergy before analgesia",
                "renal function before contrast imaging if this does not delay repair",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "ruptured or symptomatic abdominal aortic aneurysm safety checks must include unstable-patient transfer"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_sah_ct_lp_cta_neuro_and_bp_nimodipine_actions():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Aneurysmal subarachnoid hemorrhage"
    case["patient_demographics"] = {
        "age": 51,
        "sex": "female",
        "weight_kg": 63,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Sudden worst headache of life"
    case["history_of_present_illness"] = (
        "Patient developed a thunderclap headache peaking within minutes with vomiting, "
        "neck stiffness, photophobia, and transient loss of consciousness concerning for "
        "subarachnoid hemorrhage."
    )
    case["key_teaching_points"] = [
        "Thunderclap headache is a red flag for subarachnoid hemorrhage",
        "Non-contrast head CT is first-line, with LP or CTA pathway when CT is negative or delayed",
        "Aneurysmal SAH requires neurosurgical or neurocritical escalation and rebleeding prevention",
    ]
    case["clinical_red_flags"] = [
        "Thunderclap headache, worst headache of life, vomiting, neck stiffness, syncope, or seizure",
        "Reduced consciousness, focal neurologic deficit, meningism, hypertension, or sentinel headache",
    ]
    case["time_critical_actions"] = [
        "Order urgent non-contrast head CT for suspected subarachnoid hemorrhage",
        "Check glucose and provide analgesia and antiemetics",
    ]
    case["contraindication_checks"] = [
        "Review anticoagulant use, INR, platelet count, coagulopathy, DOAC or warfarin exposure, and reversal plan",
        "Use blood pressure safeguards for unsecured aneurysm and rebleeding risk while maintaining cerebral perfusion",
        "Monitor hydrocephalus, vasospasm, delayed cerebral ischemia, seizure, EVD need, ICU status, and neurocritical deterioration",
    ]
    case["clinical_sources"] = [
        {
            "title": "Subarachnoid haemorrhage caused by a ruptured aneurysm",
            "organization": "NICE",
            "url": "https://www.nice.org.uk/guidance/ng228/chapter/Recommendations",
            "supports": [
                "aneurysmal subarachnoid hemorrhage diagnosis and risk stratification",
                "thunderclap headache is a red flag for subarachnoid hemorrhage",
                "non-contrast head CT is first-line, with LP or CTA pathway when CT is negative or delayed",
                "aneurysmal SAH requires neurosurgical or neurocritical escalation and rebleeding prevention",
                "thunderclap headache, worst headache of life, vomiting, neck stiffness, syncope, or seizure as red flags",
                "reduced consciousness, focal neurologic deficit, meningism, hypertension, or sentinel headache as severity markers",
                "urgent non-contrast head CT for suspected subarachnoid hemorrhage",
                "glucose check and analgesia and antiemetics",
                "anticoagulant use, INR, platelet count, coagulopathy, DOAC or warfarin exposure, and reversal plan",
                "blood pressure safeguards for unsecured aneurysm and rebleeding risk while maintaining cerebral perfusion",
                "hydrocephalus, vasospasm, delayed cerebral ischemia, seizure, EVD need, ICU status, and neurocritical deterioration monitoring",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "subarachnoid hemorrhage time-critical actions must include urgent non-contrast head CT"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_sah_reversal_rebleeding_and_complication_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Aneurysmal subarachnoid hemorrhage"
    case["patient_demographics"] = {
        "age": 51,
        "sex": "female",
        "weight_kg": 63,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Sudden worst headache of life"
    case["history_of_present_illness"] = (
        "Patient developed a thunderclap headache peaking within minutes with vomiting, "
        "neck stiffness, photophobia, and transient loss of consciousness concerning for "
        "subarachnoid hemorrhage."
    )
    case["key_teaching_points"] = [
        "Thunderclap headache is a red flag for subarachnoid hemorrhage",
        "Non-contrast head CT is first-line, with LP or CTA pathway when CT is negative or delayed",
        "Aneurysmal SAH requires neurosurgical or neurocritical escalation and rebleeding prevention",
    ]
    case["clinical_red_flags"] = [
        "Thunderclap headache, worst headache of life, vomiting, neck stiffness, syncope, or seizure",
        "Reduced consciousness, focal neurologic deficit, meningism, hypertension, or sentinel headache",
    ]
    case["time_critical_actions"] = [
        "Order urgent non-contrast head CT for suspected subarachnoid hemorrhage",
        "If CT is negative or delayed after onset, perform lumbar puncture for xanthochromia or CTA pathway",
        "Consult neurosurgery and neurocritical care and arrange specialist transfer for aneurysm treatment",
        "Start nimodipine and use blood pressure control with nicardipine or labetalol while protecting perfusion",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before analgesia",
        "Renal function before CTA if it does not delay specialist care",
    ]
    case["clinical_sources"] = [
        {
            "title": "Subarachnoid haemorrhage caused by a ruptured aneurysm",
            "organization": "NICE",
            "url": "https://www.nice.org.uk/guidance/ng228/chapter/Recommendations",
            "supports": [
                "aneurysmal subarachnoid hemorrhage diagnosis and risk stratification",
                "thunderclap headache is a red flag for subarachnoid hemorrhage",
                "non-contrast head CT is first-line, with LP or CTA pathway when CT is negative or delayed",
                "aneurysmal SAH requires neurosurgical or neurocritical escalation and rebleeding prevention",
                "thunderclap headache, worst headache of life, vomiting, neck stiffness, syncope, or seizure as red flags",
                "reduced consciousness, focal neurologic deficit, meningism, hypertension, or sentinel headache as severity markers",
                "urgent non-contrast head CT for suspected subarachnoid hemorrhage",
                "lumbar puncture for xanthochromia or CTA pathway if CT is negative or delayed",
                "neurosurgery and neurocritical care consultation and specialist transfer for aneurysm treatment",
                "nimodipine and blood pressure control with nicardipine or labetalol while protecting perfusion",
                "medication allergy before analgesia",
                "renal function before CTA if it does not delay specialist care",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "subarachnoid hemorrhage safety checks must include anticoagulant"
        in issue
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


def test_quality_gate_requires_toxic_alcohol_gap_antidote_dialysis_and_acidosis_actions():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Methanol toxic alcohol ingestion"
    case["patient_demographics"] = {
        "age": 44,
        "sex": "male",
        "weight_kg": 74,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Confusion and visual blurring after drinking washer fluid"
    case["history_of_present_illness"] = (
        "Patient presents after suspected methanol windshield washer fluid ingestion with vomiting, "
        "confusion, visual blurring, high anion gap metabolic acidosis, and elevated osmolar gap."
    )
    case["key_teaching_points"] = [
        "Methanol and ethylene glycol toxic alcohols can present with osmolar gap early and anion gap acidosis later",
        "Fomepizole or ethanol blocks alcohol dehydrogenase and should not wait for confirmatory levels when suspicion is high",
        "Severe acidosis, visual symptoms, renal failure, coma, seizure, or high levels require dialysis planning",
    ]
    case["clinical_red_flags"] = [
        "Visual symptoms, coma, seizure, severe acidosis, or high anion gap after methanol exposure",
        "Renal injury, hypocalcemia, calcium oxalate crystals, or flank pain after ethylene glycol exposure",
    ]
    case["time_critical_actions"] = [
        "Calculate anion gap and osmolar gap with measured serum osmolality and send methanol, ethylene glycol, and toxic alcohol levels",
        "Call poison center, toxicologist, and nephrology for hemodialysis or extracorporeal escalation",
        "Treat severe metabolic acidosis with blood gas monitoring, pH reassessment, and sodium bicarbonate support",
    ]
    case["contraindication_checks"] = [
        "Review hemodialysis indications including severe acidosis, anion gap, coma, seizure, visual symptoms, renal failure, kidney failure, or high-risk level",
        "Monitor vision, optic injury, renal function, urine calcium oxalate crystals, hypocalcemia, and kidney injury",
        "Assess ethanol co-ingestion, isopropanol, salicylate, diabetic ketoacidosis, alcoholic ketoacidosis, lactic acidosis, and late presentation with normal osmolar gap",
    ]
    case["clinical_sources"] = [
        {
            "title": "Ethylene Glycol Medical Management Guidelines",
            "organization": "CDC ATSDR",
            "url": "https://wwwn.cdc.gov/TSP/MMG/MMGDetails.aspx?mmgid=82&toxid=21",
            "supports": [
                "methanol toxic alcohol ingestion diagnosis and risk stratification",
                "methanol and ethylene glycol toxic alcohols can present with osmolar gap early and anion gap acidosis later",
                "fomepizole or ethanol blocks alcohol dehydrogenase and should not wait for confirmatory levels when suspicion is high",
                "severe acidosis, visual symptoms, renal failure, coma, seizure, or high levels require dialysis planning",
                "visual symptoms, coma, seizure, severe acidosis, or high anion gap after methanol exposure as red flags",
                "renal injury, hypocalcemia, calcium oxalate crystals, or flank pain after ethylene glycol exposure as severity markers",
                "anion gap and osmolar gap with measured serum osmolality and methanol, ethylene glycol, and toxic alcohol levels",
                "poison center, toxicologist, and nephrology for hemodialysis or extracorporeal escalation",
                "severe metabolic acidosis with blood gas monitoring, pH reassessment, and sodium bicarbonate support",
                "hemodialysis indications including severe acidosis, anion gap, coma, seizure, visual symptoms, renal failure, kidney failure, or high-risk level",
                "vision, optic injury, renal function, urine calcium oxalate crystals, hypocalcemia, and kidney injury monitoring",
                "ethanol co-ingestion, isopropanol, salicylate, diabetic ketoacidosis, alcoholic ketoacidosis, lactic acidosis, and late presentation with normal osmolar gap",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "toxic alcohol time-critical actions must include anion gap"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_toxic_alcohol_dialysis_organ_and_differential_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Ethylene glycol toxic alcohol ingestion"
    case["patient_demographics"] = {
        "age": 44,
        "sex": "male",
        "weight_kg": 74,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Vomiting and confusion after antifreeze ingestion"
    case["history_of_present_illness"] = (
        "Patient presents after suspected ethylene glycol antifreeze ingestion with vomiting, "
        "confusion, high anion gap metabolic acidosis, elevated osmolar gap, flank pain, and AKI."
    )
    case["key_teaching_points"] = [
        "Methanol and ethylene glycol toxic alcohols can present with osmolar gap early and anion gap acidosis later",
        "Fomepizole or ethanol blocks alcohol dehydrogenase and should not wait for confirmatory levels when suspicion is high",
        "Severe acidosis, visual symptoms, renal failure, coma, seizure, or high levels require dialysis planning",
    ]
    case["clinical_red_flags"] = [
        "Visual symptoms, coma, seizure, severe acidosis, or high anion gap after methanol exposure",
        "Renal injury, hypocalcemia, calcium oxalate crystals, or flank pain after ethylene glycol exposure",
    ]
    case["time_critical_actions"] = [
        "Calculate anion gap and osmolar gap with measured serum osmolality and send methanol, ethylene glycol, and toxic alcohol levels",
        "Start fomepizole alcohol dehydrogenase blockade immediately or ethanol antidote if fomepizole is unavailable",
        "Call poison center, toxicologist, and nephrology for hemodialysis or extracorporeal escalation",
        "Treat severe metabolic acidosis with blood gas monitoring, pH reassessment, and sodium bicarbonate support",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Ethylene Glycol Medical Management Guidelines",
            "organization": "CDC ATSDR",
            "url": "https://wwwn.cdc.gov/TSP/MMG/MMGDetails.aspx?mmgid=82&toxid=21",
            "supports": [
                "ethylene glycol toxic alcohol ingestion diagnosis and risk stratification",
                "methanol and ethylene glycol toxic alcohols can present with osmolar gap early and anion gap acidosis later",
                "fomepizole or ethanol blocks alcohol dehydrogenase and should not wait for confirmatory levels when suspicion is high",
                "severe acidosis, visual symptoms, renal failure, coma, seizure, or high levels require dialysis planning",
                "visual symptoms, coma, seizure, severe acidosis, or high anion gap after methanol exposure as red flags",
                "renal injury, hypocalcemia, calcium oxalate crystals, or flank pain after ethylene glycol exposure as severity markers",
                "anion gap and osmolar gap with measured serum osmolality and methanol, ethylene glycol, and toxic alcohol levels",
                "fomepizole alcohol dehydrogenase blockade immediately or ethanol antidote if fomepizole is unavailable",
                "poison center, toxicologist, and nephrology for hemodialysis or extracorporeal escalation",
                "severe metabolic acidosis with blood gas monitoring, pH reassessment, and sodium bicarbonate support",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "toxic alcohol safety checks must include hemodialysis indication"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_salicylate_levels_charcoal_alkalinization_and_dialysis_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Salicylate toxicity"
    case["patient_demographics"] = {
        "age": 37,
        "sex": "female",
        "weight_kg": 68,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Vomiting, tinnitus, and rapid breathing after aspirin ingestion"
    case["history_of_present_illness"] = (
        "Patient presents after a large aspirin overdose with vomiting, tinnitus, tachypnea, "
        "fever, confusion, respiratory alkalosis, and anion gap metabolic acidosis."
    )
    case["key_teaching_points"] = [
        "Salicylate toxicity requires serial salicylate levels because absorption can be delayed",
        "Sodium bicarbonate with urine alkalinization increases salicylate elimination",
        "Severe salicylate poisoning needs early poison center, nephrology, and hemodialysis planning",
    ]
    case["clinical_red_flags"] = [
        "Tinnitus, vomiting, tachypnea, fever, confusion, seizure, or pulmonary edema",
        "Mixed respiratory alkalosis and metabolic acidosis with rising salicylate level",
    ]
    case["time_critical_actions"] = [
        "Trend serial salicylate level, anion gap, ABG or VBG blood gas, and electrolytes until clearly falling",
        "Start sodium bicarbonate infusion for serum and urine alkalinization with potassium repletion and urine pH monitoring",
        "Call poison center, toxicologist, and nephrology for hemodialysis or dialysis escalation",
    ]
    case["contraindication_checks"] = [
        "Review hemodialysis indications including acidemia, severe acidosis, altered mental status, seizure, renal failure, pulmonary edema, or very high salicylate level",
        "If intubation or mechanical ventilation is unavoidable, preserve hyperventilation and pH with bicarbonate bolus safeguards",
        "Monitor potassium, hypokalemia, glucose, hypoglycemia, temperature, pulmonary edema, and cerebral edema",
    ]
    case["clinical_sources"] = [
        {
            "title": "Guidance Document: Management Priorities in Salicylate Toxicity",
            "organization": "American College of Medical Toxicology",
            "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC4371029/",
            "supports": [
                "salicylate toxicity diagnosis and risk stratification",
                "salicylate toxicity requires serial salicylate levels because absorption can be delayed",
                "sodium bicarbonate with urine alkalinization increases salicylate elimination",
                "severe salicylate poisoning needs early poison center, nephrology, and hemodialysis planning",
                "tinnitus, vomiting, tachypnea, fever, confusion, seizure, or pulmonary edema as red flags",
                "mixed respiratory alkalosis and metabolic acidosis with rising salicylate level as severity markers",
                "serial salicylate level, anion gap, ABG or VBG blood gas, and electrolytes until clearly falling",
                "sodium bicarbonate infusion for serum and urine alkalinization with potassium repletion and urine pH monitoring",
                "poison center, toxicologist, and nephrology for hemodialysis or dialysis escalation",
                "hemodialysis indications including acidemia, severe acidosis, altered mental status, seizure, renal failure, pulmonary edema, or very high salicylate level",
                "intubation or mechanical ventilation safeguards to preserve hyperventilation and pH with bicarbonate bolus",
                "potassium, hypokalemia, glucose, hypoglycemia, temperature, pulmonary edema, and cerebral edema monitoring",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "salicylate toxicity time-critical actions must include serial salicylate levels"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_salicylate_dialysis_intubation_and_electrolyte_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Salicylate toxicity"
    case["patient_demographics"] = {
        "age": 37,
        "sex": "female",
        "weight_kg": 68,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Vomiting, tinnitus, and rapid breathing after aspirin ingestion"
    case["history_of_present_illness"] = (
        "Patient presents after a large aspirin overdose with vomiting, tinnitus, tachypnea, "
        "fever, confusion, respiratory alkalosis, and anion gap metabolic acidosis."
    )
    case["key_teaching_points"] = [
        "Salicylate toxicity requires serial salicylate levels because absorption can be delayed",
        "Sodium bicarbonate with urine alkalinization increases salicylate elimination",
        "Severe salicylate poisoning needs early poison center, nephrology, and hemodialysis planning",
    ]
    case["clinical_red_flags"] = [
        "Tinnitus, vomiting, tachypnea, fever, confusion, seizure, or pulmonary edema",
        "Mixed respiratory alkalosis and metabolic acidosis with rising salicylate level",
    ]
    case["time_critical_actions"] = [
        "Trend serial salicylate level, anion gap, ABG or VBG blood gas, and electrolytes until clearly falling",
        "Give activated charcoal and consider multidose charcoal if ongoing absorption or bezoar concern",
        "Start sodium bicarbonate infusion for serum and urine alkalinization with potassium repletion and urine pH monitoring",
        "Call poison center, toxicologist, and nephrology for hemodialysis or dialysis escalation",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Guidance Document: Management Priorities in Salicylate Toxicity",
            "organization": "American College of Medical Toxicology",
            "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC4371029/",
            "supports": [
                "salicylate toxicity diagnosis and risk stratification",
                "salicylate toxicity requires serial salicylate levels because absorption can be delayed",
                "sodium bicarbonate with urine alkalinization increases salicylate elimination",
                "severe salicylate poisoning needs early poison center, nephrology, and hemodialysis planning",
                "tinnitus, vomiting, tachypnea, fever, confusion, seizure, or pulmonary edema as red flags",
                "mixed respiratory alkalosis and metabolic acidosis with rising salicylate level as severity markers",
                "serial salicylate level, anion gap, ABG or VBG blood gas, and electrolytes until clearly falling",
                "activated charcoal and multidose charcoal if ongoing absorption or bezoar concern",
                "sodium bicarbonate infusion for serum and urine alkalinization with potassium repletion and urine pH monitoring",
                "poison center, toxicologist, and nephrology for hemodialysis or dialysis escalation",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "salicylate toxicity safety checks must include hemodialysis indication"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_carbon_monoxide_oxygen_cohb_hbo_and_cardiac_neuro_actions():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Carbon monoxide poisoning"
    case["patient_demographics"] = {
        "age": 29,
        "sex": "female",
        "weight_kg": 62,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Headache, dizziness, and syncope after generator exhaust exposure"
    case["history_of_present_illness"] = (
        "Patient was found after indoor generator exhaust exposure with headache, nausea, "
        "dizziness, syncope, confusion, chest tightness, and suspected carbon monoxide poisoning."
    )
    case["key_teaching_points"] = [
        "Pulse oximetry can be falsely normal in carbon monoxide poisoning",
        "Carboxyhemoglobin by co-oximetry confirms exposure but treatment starts immediately",
        "Hyperbaric oxygen should be considered for pregnancy, neurologic symptoms, loss of consciousness, acidosis, or cardiac ischemia",
    ]
    case["clinical_red_flags"] = [
        "Syncope, altered mental status, seizure, chest pain, cardiac ischemia, or severe acidosis",
        "Multiple exposed household members, generator exhaust, smoke inhalation, or pregnancy",
    ]
    case["time_critical_actions"] = [
        "Remove from source and start 100% high-flow oxygen by non-rebreather immediately",
        "Send venous blood gas with co-oximetry and carboxyhemoglobin COHb level",
        "Obtain ECG, troponin, lactate, neurologic exam, and reassess altered mental status or syncope",
    ]
    case["contraindication_checks"] = [
        "Document that normal pulse oximetry or SpO2 can be falsely normal and cannot exclude carbon monoxide poisoning",
        "Review hyperbaric oxygen criteria including pregnancy, neurologic symptoms, loss of consciousness, syncope, acidosis, cardiac ischemia, or high carboxyhemoglobin COHb",
        "Monitor cardiac ECG, troponin, lactate, metabolic acidosis, myocardial injury, delayed neurologic sequelae, and neurocognitive symptoms",
        "Assess smoke inhalation, burn, fire exposure, cyanide co-toxicity, lactate elevation, and hydroxocobalamin need",
    ]
    case["clinical_sources"] = [
        {
            "title": "Carbon Monoxide Poisoning",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/injuries-poisoning/poisoning/carbon-monoxide-poisoning",
            "supports": [
                "carbon monoxide poisoning diagnosis and risk stratification",
                "pulse oximetry can be falsely normal in carbon monoxide poisoning",
                "carboxyhemoglobin by co-oximetry confirms exposure but treatment starts immediately",
                "hyperbaric oxygen should be considered for pregnancy, neurologic symptoms, loss of consciousness, acidosis, or cardiac ischemia",
                "syncope, altered mental status, seizure, chest pain, cardiac ischemia, or severe acidosis as red flags",
                "multiple exposed household members, generator exhaust, smoke inhalation, or pregnancy as severity markers",
                "remove from source and start 100% high-flow oxygen by non-rebreather immediately",
                "venous blood gas with co-oximetry and carboxyhemoglobin COHb level",
                "ECG, troponin, lactate, neurologic exam, and altered mental status or syncope reassessment",
                "normal pulse oximetry or SpO2 can be falsely normal and cannot exclude carbon monoxide poisoning",
                "hyperbaric oxygen criteria including pregnancy, neurologic symptoms, loss of consciousness, syncope, acidosis, cardiac ischemia, or high carboxyhemoglobin COHb",
                "cardiac ECG, troponin, lactate, metabolic acidosis, myocardial injury, delayed neurologic sequelae, and neurocognitive symptoms monitoring",
                "smoke inhalation, burn, fire exposure, cyanide co-toxicity, lactate elevation, and hydroxocobalamin need",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "carbon monoxide poisoning time-critical actions must include source removal"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_carbon_monoxide_pulse_ox_hbo_complication_and_smoke_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Carbon monoxide poisoning"
    case["patient_demographics"] = {
        "age": 29,
        "sex": "female",
        "weight_kg": 62,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Headache, dizziness, and syncope after generator exhaust exposure"
    case["history_of_present_illness"] = (
        "Patient was found after indoor generator exhaust exposure with headache, nausea, "
        "dizziness, syncope, confusion, chest tightness, and suspected carbon monoxide poisoning."
    )
    case["key_teaching_points"] = [
        "Pulse oximetry can be falsely normal in carbon monoxide poisoning",
        "Carboxyhemoglobin by co-oximetry confirms exposure but treatment starts immediately",
        "Hyperbaric oxygen should be considered for pregnancy, neurologic symptoms, loss of consciousness, acidosis, or cardiac ischemia",
    ]
    case["clinical_red_flags"] = [
        "Syncope, altered mental status, seizure, chest pain, cardiac ischemia, or severe acidosis",
        "Multiple exposed household members, generator exhaust, smoke inhalation, or pregnancy",
    ]
    case["time_critical_actions"] = [
        "Remove from source and start 100% high-flow oxygen by non-rebreather immediately",
        "Send venous blood gas with co-oximetry and carboxyhemoglobin COHb level",
        "Call poison center and hyperbaric oxygen HBOT specialist for severe carbon monoxide poisoning",
        "Obtain ECG, troponin, lactate, neurologic exam, and reassess altered mental status or syncope",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Carbon Monoxide Poisoning",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/injuries-poisoning/poisoning/carbon-monoxide-poisoning",
            "supports": [
                "carbon monoxide poisoning diagnosis and risk stratification",
                "pulse oximetry can be falsely normal in carbon monoxide poisoning",
                "carboxyhemoglobin by co-oximetry confirms exposure but treatment starts immediately",
                "hyperbaric oxygen should be considered for pregnancy, neurologic symptoms, loss of consciousness, acidosis, or cardiac ischemia",
                "syncope, altered mental status, seizure, chest pain, cardiac ischemia, or severe acidosis as red flags",
                "multiple exposed household members, generator exhaust, smoke inhalation, or pregnancy as severity markers",
                "remove from source and start 100% high-flow oxygen by non-rebreather immediately",
                "venous blood gas with co-oximetry and carboxyhemoglobin COHb level",
                "poison center and hyperbaric oxygen HBOT specialist for severe carbon monoxide poisoning",
                "ECG, troponin, lactate, neurologic exam, and altered mental status or syncope reassessment",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "carbon monoxide poisoning safety checks must include pulse oximetry"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_cyanide_source_oxygen_antidote_lactate_and_poison_escalation():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Cyanide poisoning from smoke inhalation"
    case["patient_demographics"] = {
        "age": 48,
        "sex": "male",
        "weight_kg": 81,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Confusion and shock after house fire smoke inhalation"
    case["history_of_present_illness"] = (
        "Patient rescued from enclosed-space fire has soot exposure, coma/confusion, "
        "hypotension, severe lactic acidosis, high anion gap metabolic acidosis, and "
        "suspected cyanide poisoning."
    )
    case["key_teaching_points"] = [
        "Cyanide poisoning after smoke inhalation can cause rapid coma, shock, and severe lactic acidosis",
        "Hydroxocobalamin or Cyanokit should be given empirically when severe cyanide poisoning is suspected",
        "Cyanide levels are not rapidly available and treatment should not wait for confirmation",
    ]
    case["clinical_red_flags"] = [
        "Smoke inhalation with coma, altered mental status, hypotension, shock, seizure, or cardiac arrest",
        "Severe lactic acidosis, high anion gap metabolic acidosis, cardiovascular collapse, or soot exposure",
    ]
    case["time_critical_actions"] = [
        "Remove from source and give 100% oxygen with respiratory support and circulatory support",
        "Check lactate, ABG or VBG blood gas, pH, anion gap, and metabolic acidosis severity",
        "Call poison center, toxicologist, ICU, and burn center for escalation",
    ]
    case["contraindication_checks"] = [
        "Do not wait for cyanide level; give empiric antidote when clinical suspicion is high and do not delay treatment",
        "Assess smoke inhalation with carbon monoxide co poisoning, carboxyhemoglobin COHb, and avoid nitrite-induced methemoglobinemia when oxygen delivery is impaired",
        "Monitor shock, hypotension, cardiac arrest, coma, seizure, syncope, and altered mental status",
        "Monitor hydroxocobalamin effects including blood pressure hypertension, red urine chromaturia, lab interference, and dialysis interference",
    ]
    case["clinical_sources"] = [
        {
            "title": "Cyanide Poisoning",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/injuries-poisoning/poisoning/cyanide-poisoning",
            "supports": [
                "cyanide poisoning diagnosis and risk stratification",
                "cyanide poisoning after smoke inhalation can cause rapid coma, shock, and severe lactic acidosis",
                "hydroxocobalamin or Cyanokit should be given empirically when severe cyanide poisoning is suspected",
                "cyanide levels are not rapidly available and treatment should not wait for confirmation",
                "smoke inhalation with coma, altered mental status, hypotension, shock, seizure, or cardiac arrest as red flags",
                "severe lactic acidosis, high anion gap metabolic acidosis, cardiovascular collapse, or soot exposure as severity markers",
                "remove from source and give 100% oxygen with respiratory support and circulatory support",
                "lactate, ABG or VBG blood gas, pH, anion gap, and metabolic acidosis severity assessment",
                "poison center, toxicologist, ICU, and burn center escalation",
                "do not wait for cyanide level and give empiric antidote when clinical suspicion is high",
                "smoke inhalation with carbon monoxide co poisoning, carboxyhemoglobin COHb, and nitrite-induced methemoglobinemia review",
                "shock, hypotension, cardiac arrest, coma, seizure, syncope, and altered mental status monitoring",
                "hydroxocobalamin effects including blood pressure hypertension, red urine chromaturia, lab interference, and dialysis interference monitoring",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "cyanide poisoning time-critical actions must include source removal"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_cyanide_level_smoke_shock_and_hydroxocobalamin_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Cyanide poisoning from smoke inhalation"
    case["patient_demographics"] = {
        "age": 48,
        "sex": "male",
        "weight_kg": 81,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Confusion and shock after house fire smoke inhalation"
    case["history_of_present_illness"] = (
        "Patient rescued from enclosed-space fire has soot exposure, coma/confusion, "
        "hypotension, severe lactic acidosis, high anion gap metabolic acidosis, and "
        "suspected cyanide poisoning."
    )
    case["key_teaching_points"] = [
        "Cyanide poisoning after smoke inhalation can cause rapid coma, shock, and severe lactic acidosis",
        "Hydroxocobalamin or Cyanokit should be given empirically when severe cyanide poisoning is suspected",
        "Cyanide levels are not rapidly available and treatment should not wait for confirmation",
    ]
    case["clinical_red_flags"] = [
        "Smoke inhalation with coma, altered mental status, hypotension, shock, seizure, or cardiac arrest",
        "Severe lactic acidosis, high anion gap metabolic acidosis, cardiovascular collapse, or soot exposure",
    ]
    case["time_critical_actions"] = [
        "Remove from source and give 100% oxygen with respiratory support and circulatory support",
        "Give hydroxocobalamin Cyanokit antidote immediately and consider sodium thiosulfate with toxicologist guidance",
        "Check lactate, ABG or VBG blood gas, pH, anion gap, and metabolic acidosis severity",
        "Call poison center, toxicologist, ICU, and burn center for escalation",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before antiemetics",
        "Pregnancy status before imaging if needed",
    ]
    case["clinical_sources"] = [
        {
            "title": "Cyanide Poisoning",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/injuries-poisoning/poisoning/cyanide-poisoning",
            "supports": [
                "cyanide poisoning diagnosis and risk stratification",
                "cyanide poisoning after smoke inhalation can cause rapid coma, shock, and severe lactic acidosis",
                "hydroxocobalamin or Cyanokit should be given empirically when severe cyanide poisoning is suspected",
                "cyanide levels are not rapidly available and treatment should not wait for confirmation",
                "smoke inhalation with coma, altered mental status, hypotension, shock, seizure, or cardiac arrest as red flags",
                "severe lactic acidosis, high anion gap metabolic acidosis, cardiovascular collapse, or soot exposure as severity markers",
                "remove from source and give 100% oxygen with respiratory support and circulatory support",
                "hydroxocobalamin Cyanokit antidote immediately and sodium thiosulfate with toxicologist guidance",
                "lactate, ABG or VBG blood gas, pH, anion gap, and metabolic acidosis severity assessment",
                "poison center, toxicologist, ICU, and burn center escalation",
                "medication allergy before antiemetics",
                "pregnancy status before imaging if needed",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "cyanide poisoning safety checks must include empiric antidote"
        in issue
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


def test_quality_gate_requires_cardiac_tamponade_echo_drainage_specialist_and_hemodynamic_actions():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Cardiac tamponade"
    case["patient_demographics"] = {
        "age": 62,
        "sex": "male",
        "weight_kg": 76,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Hypotension and dyspnea after chest pain"
    case["history_of_present_illness"] = (
        "Patient has progressive dyspnea, chest discomfort, hypotension, tachycardia, "
        "elevated JVP, muffled heart sounds, pulsus paradoxus, and suspected cardiac tamponade."
    )
    case["key_teaching_points"] = [
        "Cardiac tamponade is an obstructive shock emergency",
        "Bedside echo or cardiac POCUS helps confirm pericardial effusion and tamponade physiology",
        "Unstable tamponade requires immediate pericardial drainage rather than delayed CT workup",
    ]
    case["clinical_red_flags"] = [
        "Hypotension, tachycardia, elevated JVP, muffled heart sounds, or pulsus paradoxus",
        "Shock, syncope, dyspnea, chest pain, electrical alternans, or narrow pulse pressure",
    ]
    case["time_critical_actions"] = [
        "Perform bedside echo or cardiac POCUS ultrasound to assess pericardial effusion and tamponade physiology",
        "Give cautious fluid bolus and vasopressor support for hypotension and shock while preparing definitive care",
    ]
    case["contraindication_checks"] = [
        "Unstable suspected tamponade is a clinical diagnosis and do not delay immediate drainage for CT or prolonged workup",
        "Review anticoagulation, thrombolysis, bleeding, coagulopathy, INR, platelet count, DOAC, warfarin, and reversal needs",
        "Assess trauma, iatrogenic procedure, myocardial infarction rupture, aortic dissection, malignancy, uremia, and renal failure causes",
    ]
    case["clinical_sources"] = [
        {
            "title": "Cardiac Tamponade",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/injuries-poisoning/thoracic-trauma/cardiac-tamponade",
            "supports": [
                "cardiac tamponade diagnosis and obstructive shock risk stratification",
                "cardiac tamponade is an obstructive shock emergency",
                "bedside echo or cardiac POCUS helps confirm pericardial effusion and tamponade physiology",
                "unstable tamponade requires immediate pericardial drainage rather than delayed CT workup",
                "hypotension, tachycardia, elevated JVP, muffled heart sounds, or pulsus paradoxus as red flags",
                "shock, syncope, dyspnea, chest pain, electrical alternans, or narrow pulse pressure as severity markers",
                "bedside echo or cardiac POCUS ultrasound to assess pericardial effusion and tamponade physiology",
                "cautious fluid bolus and vasopressor support for hypotension and shock while preparing definitive care",
                "unstable suspected tamponade is a clinical diagnosis and do not delay immediate drainage for CT or prolonged workup",
                "anticoagulation, thrombolysis, bleeding, coagulopathy, INR, platelet count, DOAC, warfarin, and reversal needs",
                "trauma, iatrogenic procedure, myocardial infarction rupture, aortic dissection, malignancy, uremia, and renal failure causes",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "cardiac tamponade time-critical actions must include bedside echo"
        in issue
        for issue in report.critical_issues
    )


def test_quality_gate_requires_cardiac_tamponade_no_delay_reversal_and_cause_safety():
    case = copy.deepcopy(CASE_POOL[0])
    case["diagnosis"] = "Cardiac tamponade"
    case["patient_demographics"] = {
        "age": 62,
        "sex": "male",
        "weight_kg": 76,
        "ethnicity": "Korean",
    }
    case["chief_complaint"] = "Hypotension and dyspnea after chest pain"
    case["history_of_present_illness"] = (
        "Patient has progressive dyspnea, chest discomfort, hypotension, tachycardia, "
        "elevated JVP, muffled heart sounds, pulsus paradoxus, and suspected cardiac tamponade."
    )
    case["key_teaching_points"] = [
        "Cardiac tamponade is an obstructive shock emergency",
        "Bedside echo or cardiac POCUS helps confirm pericardial effusion and tamponade physiology",
        "Unstable tamponade requires immediate pericardial drainage rather than delayed CT workup",
    ]
    case["clinical_red_flags"] = [
        "Hypotension, tachycardia, elevated JVP, muffled heart sounds, or pulsus paradoxus",
        "Shock, syncope, dyspnea, chest pain, electrical alternans, or narrow pulse pressure",
    ]
    case["time_critical_actions"] = [
        "Perform bedside echo or cardiac POCUS ultrasound to assess pericardial effusion and tamponade physiology",
        "Prepare immediate pericardiocentesis with subxiphoid pericardial drainage or pericardial window if needed",
        "Escalate cardiology, cardiothoracic surgery, thoracic surgery, trauma surgery, or emergency surgery immediately",
        "Give cautious fluid bolus and vasopressor support for hypotension and shock while preparing definitive care",
    ]
    case["contraindication_checks"] = [
        "Medication allergy before analgesia",
        "Renal function before contrast imaging if stable enough for imaging",
    ]
    case["clinical_sources"] = [
        {
            "title": "Cardiac Tamponade",
            "organization": "Merck Manual Professional Edition",
            "url": "https://www.merckmanuals.com/professional/injuries-poisoning/thoracic-trauma/cardiac-tamponade",
            "supports": [
                "cardiac tamponade diagnosis and obstructive shock risk stratification",
                "cardiac tamponade is an obstructive shock emergency",
                "bedside echo or cardiac POCUS helps confirm pericardial effusion and tamponade physiology",
                "unstable tamponade requires immediate pericardial drainage rather than delayed CT workup",
                "hypotension, tachycardia, elevated JVP, muffled heart sounds, or pulsus paradoxus as red flags",
                "shock, syncope, dyspnea, chest pain, electrical alternans, or narrow pulse pressure as severity markers",
                "bedside echo or cardiac POCUS ultrasound to assess pericardial effusion and tamponade physiology",
                "immediate pericardiocentesis with subxiphoid pericardial drainage or pericardial window if needed",
                "cardiology, cardiothoracic surgery, thoracic surgery, trauma surgery, or emergency surgery immediately",
                "cautious fluid bolus and vasopressor support for hypotension and shock while preparing definitive care",
                "medication allergy before analgesia",
                "renal function before contrast imaging if stable enough for imaging",
            ],
        }
    ]

    report = evaluate_case_quality(ClinicalCaseCreate(**case))

    assert not report.passed
    assert any(
        "cardiac tamponade safety checks must include unstable-patient"
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
