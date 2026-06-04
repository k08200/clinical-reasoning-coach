"""
Clinical case quality gate.

This does not certify medical correctness. It prevents obviously incomplete or
unsafe educational cases from entering the coaching flow without clinician review.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable
from urllib.parse import urlparse

from app.schemas.case import ClinicalCaseCreate
from app.services.privacy_guard import detect_patient_identifiers

MIN_PASSING_SCORE = 85
MIN_REVIEWED_SOURCE_ORGANIZATIONS = 2
ALLOWED_REVIEW_STATUSES = {
    "ai_generated_unreviewed",
    "educational_draft",
    "clinician_reviewed",
}
PLACEHOLDER_SOURCE_HOSTS = {
    "example.com",
    "example.org",
    "example.net",
    "example.test",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
}
TRUSTED_CLINICAL_SOURCE_HOSTS = {
    "acc.org",
    "acep.org",
    "acpjournals.org",
    "acponline.org",
    "acpjc.org",
    "ada.org",
    "ahajournals.org",
    "annals.org",
    "bmj.com",
    "cdc.gov",
    "diabetes.org",
    "escardio.org",
    "heart.org",
    "idsociety.org",
    "jacc.org",
    "jamanetwork.com",
    "lancet.com",
    "nejm.org",
    "nice.org.uk",
    "nih.gov",
    "professional.diabetes.org",
    "pubmed.ncbi.nlm.nih.gov",
    "sccm.org",
    "thelancet.com",
    "who.int",
}
TRUSTED_CLINICAL_SOURCE_SUFFIXES = {
    ".edu",
    ".gov",
}
DIAGNOSIS_LEAK_STOPWORDS = {
    "a",
    "an",
    "and",
    "by",
    "acute",
    "chronic",
    "class",
    "due",
    "exacerbation",
    "from",
    "in",
    "likely",
    "mild",
    "moderate",
    "of",
    "or",
    "probable",
    "secondary",
    "severe",
    "stage",
    "suspected",
    "syndrome",
    "the",
    "to",
    "type",
    "with",
}
DIAGNOSIS_SINGLE_TOKEN_LEAK_TERMS = {
    "anaphylaxis",
    "appendicitis",
    "bacteremia",
    "bronchiolitis",
    "cellulitis",
    "cholangitis",
    "cholecystitis",
    "colitis",
    "diverticulitis",
    "eclampsia",
    "embolism",
    "endocarditis",
    "hemorrhage",
    "infarction",
    "ischemia",
    "ketoacidosis",
    "meningitis",
    "myocarditis",
    "nephrolithiasis",
    "osteomyelitis",
    "pancreatitis",
    "pericarditis",
    "peritonitis",
    "pneumonia",
    "pneumothorax",
    "preeclampsia",
    "pyelonephritis",
    "sepsis",
    "stroke",
    "thrombosis",
    "urosepsis",
}
DIAGNOSIS_LEAK_ALIASES = {
    "acute coronary syndrome": ["acute coronary syndrome", "acs"],
    "myocardial infarction": ["myocardial infarction", "heart attack"],
    "stemi": [
        "stemi",
        "st elevation",
        "st-elevation",
        "myocardial infarction",
        "heart attack",
        "acute coronary syndrome",
        "acs",
    ],
    "nstemi": [
        "nstemi",
        "non st elevation",
        "non-st elevation",
        "myocardial infarction",
    ],
    "septic shock": ["septic shock", "sepsis", "urosepsis"],
    "pulmonary embolism": ["pulmonary embolism", "embolism"],
    "diabetic ketoacidosis": ["diabetic ketoacidosis", "ketoacidosis", "dka"],
    "acute ischemic stroke": ["acute ischemic stroke", "ischemic stroke"],
}
LEARNER_VISIBLE_CASE_TEXT_FIELDS = [
    "title",
    "chief_complaint",
    "history_of_present_illness",
    "past_medical_history",
]
SOURCE_SUPPORT_SCOPE_PATTERNS = {
    "diagnosis or diagnostic reasoning": [
        r"\bdiagnos",
        r"\bdifferential\b",
        r"\bcriteria\b",
        r"\brisk stratification\b",
        r"\bpathway\b",
    ],
    "red flags or severity markers": [
        r"\bred flags?\b",
        r"\bhigh[- ]risk\b",
        r"\blife[- ]threatening\b",
        r"\bseverity\b",
        r"\bshock\b",
        r"\bhypoperfusion\b",
        r"\bhemodynamic\b",
        r"\binstability\b",
        r"\borgan dysfunction\b",
        r"\brv strain\b",
        r"\bacidosis\b",
    ],
    "time-critical actions": [
        r"\btime[- ]critical\b",
        r"\btiming\b",
        r"\bwithin\b",
        r"\bimmediate",
        r"\burgent",
        r"\bactivation\b",
        r"\bbundle\b",
        r"\breperfusion\b",
        r"\bthrombolysis\b",
        r"\bthrombectomy\b",
        r"\bescalation\b",
    ],
    "contraindication or safety checks": [
        r"\bcontraindication",
        r"\bsafety checks?\b",
        r"\ballerg",
        r"\bbleeding\b",
        r"\brenal\b",
        r"\bpregnancy\b",
        r"\bblood pressure\b",
        r"\bpotassium\b",
        r"\bsurgery\b",
        r"\banticoag",
        r"\bcontrast\b",
        r"\bthreshold",
        r"\bbefore\b",
    ],
}
SOURCE_SUPPORT_COVERAGE_FIELDS = {
    "clinical_red_flags": "clinical red flags",
    "time_critical_actions": "time-critical actions",
    "contraindication_checks": "contraindication checks",
}
SOURCE_SUPPORT_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "before",
    "by",
    "case",
    "check",
    "checks",
    "clinical",
    "criteria",
    "features",
    "for",
    "from",
    "in",
    "into",
    "is",
    "markers",
    "of",
    "or",
    "patient",
    "patients",
    "risk",
    "risks",
    "safety",
    "severity",
    "sign",
    "signs",
    "the",
    "therapy",
    "to",
    "with",
}
SOURCE_SUPPORT_TOKEN_ALIASES = {
    "antibiotics": "antibiotic",
    "anticoagulation": "anticoagulant",
    "anticoagulated": "anticoagulant",
    "anticoagulants": "anticoagulant",
    "antithrombotics": "antithrombotic",
    "cultures": "culture",
    "allergies": "allergy",
    "fluids": "fluid",
    "hypotension": "hypotensive",
    "hypoxemia": "hypoxia",
    "ischaemic": "ischemic",
    "ischemia": "ischemic",
    "platelets": "platelet",
    "surgical": "surgery",
    "thrombolysis": "thrombolytic",
    "vasopressors": "vasopressor",
}
PREGNANCY_SAFETY_TERMS = (
    "pregnancy",
    "pregnant",
    "gestation",
    "gestational",
    "hcg",
    "beta hcg",
    "beta-hcg",
    "임신",
)
PEDIATRIC_WEIGHT_SAFETY_TERMS = (
    "weight",
    "weight-based",
    "weight based",
    "kg",
    "dose",
    "dosing",
    "mg/kg",
    "ml/kg",
    "units/kg",
    "체중",
)
RENAL_RISK_TRIGGER_TERMS = (
    "aminoglycoside",
    "antibiotic dosing",
    "antimicrobial dosing",
    "ckd",
    "contrast",
    "creatinine",
    "ct pulmonary angiography",
    "ctpa",
    "egfr",
    "kidney",
    "metformin",
    "renal",
    "vancomycin",
    "조영제",
    "크레아티닌",
    "신장",
    "콩팥",
)
RENAL_SAFETY_TERMS = (
    "creatinine",
    "egfr",
    "kidney",
    "renal",
    "신장",
    "콩팥",
    "크레아티닌",
)
HIGH_RISK_THERAPY_TRIGGER_TERMS = (
    "alteplase",
    "anticoagulation",
    "anticoagulant",
    "anticoagulants",
    "antiplatelet",
    "antiplatelets",
    "antithrombotic",
    "antithrombotics",
    "aspirin",
    "heparin",
    "reperfusion",
    "thrombolysis",
    "thrombolytic",
    "tpa",
    "혈전용해",
    "항응고",
    "항혈소판",
    "아스피린",
    "헤파린",
)
HEMORRHAGE_SAFETY_TERMS = (
    "active bleeding",
    "anticoagulation",
    "anticoagulant",
    "anticoagulants",
    "aortic dissection",
    "bleed",
    "bleeding",
    "blood pressure",
    "bp",
    "dissection",
    "haemorrhage",
    "hemorrhage",
    "intracranial hemorrhage",
    "platelet",
    "platelets",
    "recent surgery",
    "surgery",
    "출혈",
    "두개내출혈",
    "수술",
    "혈소판",
    "혈압",
    "대동맥박리",
    "대동맥 박리",
)
INFECTION_TREATMENT_TRIGGER_TERMS = (
    "antibiotic",
    "antibiotics",
    "antimicrobial",
    "antimicrobials",
    "bacteremia",
    "empiric antibiotics",
    "sepsis",
    "sepsis bundle",
    "septic",
    "septic shock",
    "source control",
    "urosepsis",
    "감염",
    "균혈증",
    "패혈증",
    "항균제",
    "항생제",
)
INFECTION_CULTURE_TERMS = (
    "blood culture",
    "blood cultures",
    "culture",
    "cultures",
    "배양",
    "혈액배양",
    "혈액 배양",
)
INFECTION_TREATMENT_ACTION_TERMS = (
    "antibiotic",
    "antibiotics",
    "antimicrobial",
    "antimicrobials",
    "source control",
    "항균제",
    "항생제",
    "감염원 조절",
)
ANTIMICROBIAL_ALLERGY_SAFETY_TERMS = (
    "allergies",
    "allergy",
    "drug allergy",
    "medication allergy",
    "알레르기",
    "약물 알레르기",
)
ANTIMICROBIAL_DOSING_SAFETY_TERMS = (
    "creatinine",
    "dose",
    "dosing",
    "egfr",
    "kidney",
    "renal",
    "신장",
    "용량",
    "콩팥",
    "크레아티닌",
)
DKA_TREATMENT_TRIGGER_TERMS = (
    "anion gap",
    "diabetic ketoacidosis",
    "dka",
    "hyperglycemic crisis",
    "insulin infusion",
    "insulin therapy",
    "ketoacidosis",
    "ketones",
    "케톤산증",
    "인슐린",
)
DKA_POTASSIUM_ACTION_TERMS = (
    "k",
    "potassium",
    "칼륨",
)
DKA_FLUID_INSULIN_ACTION_TERMS = (
    "fluid",
    "fluids",
    "insulin",
    "수액",
    "인슐린",
)
DKA_CLOSURE_MONITORING_TERMS = (
    "anion gap",
    "gap closes",
    "gap closure",
    "ketone",
    "ketones",
    "metabolic correction",
    "close the anion gap",
    "음이온차",
    "케톤",
)
DKA_POTASSIUM_SAFETY_TERMS = (
    "k",
    "potassium",
    "threshold",
    "칼륨",
    "역치",
)
DKA_OSMOLAR_SAFETY_TERMS = (
    "cerebral edema",
    "fluid",
    "osmolar",
    "osmolar shift",
    "osmolality",
    "rapid correction",
    "sodium",
    "뇌부종",
    "삼투",
    "수액",
)
STROKE_CONTEXT_TERMS = (
    "acute ischemic stroke",
    "brain attack",
    "cerebrovascular accident",
    "ischemic stroke",
    "large vessel occlusion",
    "nihss",
    "stroke",
    "stroke pathway",
    "뇌경색",
    "뇌졸중",
)
STROKE_REPERFUSION_TRIGGER_TERMS = (
    "alteplase",
    "last known normal",
    "last known well",
    "lkn",
    "lkw",
    "reperfusion",
    "thrombectomy",
    "thrombolysis",
    "thrombolytic",
    "tpa",
    "혈전용해",
    "혈전제거",
    "재관류",
)
STROKE_LAST_KNOWN_NORMAL_TERMS = (
    "last known normal",
    "last known well",
    "lkn",
    "lkw",
    "symptom onset",
    "최종 정상",
    "마지막 정상",
)
STROKE_BRAIN_IMAGING_TERMS = (
    "brain imaging",
    "ct",
    "head ct",
    "mri",
    "neuroimaging",
    "noncontrast",
    "non-contrast",
    "뇌영상",
    "비조영",
)
STROKE_REPERFUSION_ACTION_TERMS = (
    "alteplase",
    "eligibility",
    "reperfusion",
    "thrombectomy",
    "thrombolysis",
    "tpa",
    "혈전용해",
    "혈전제거",
    "재관류",
)
STROKE_HEMORRHAGE_EXCLUSION_TERMS = (
    "bleeding",
    "ct",
    "haemorrhage",
    "hemorrhage",
    "imaging",
    "intracranial hemorrhage",
    "noncontrast",
    "non-contrast",
    "출혈",
    "두개내출혈",
    "비조영",
)
STROKE_ANTICOAGULANT_SAFETY_TERMS = (
    "anticoagulant",
    "anticoagulation",
    "apixaban",
    "bleeding history",
    "doac",
    "inr",
    "warfarin",
    "항응고",
)
STROKE_PLATELET_TERMS = (
    "platelet",
    "platelets",
    "혈소판",
)
STROKE_GLUCOSE_TERMS = (
    "glucose",
    "hypoglycemia",
    "혈당",
)
STROKE_BP_TERMS = (
    "blood pressure",
    "bp",
    "hypertension",
    "혈압",
)
PE_CONTEXT_TERMS = (
    "ct pulmonary angiography",
    "ctpa",
    "d-dimer",
    "dvt",
    "pe",
    "pulmonary embolism",
    "rv strain",
    "right ventricular strain",
    "wells",
    "폐색전",
    "폐색전증",
)
PE_RISK_STRATIFICATION_TERMS = (
    "massive",
    "risk stratification",
    "risk stratify",
    "submassive",
    "wells",
    "위험도",
)
PE_HEMODYNAMIC_TERMS = (
    "blood pressure",
    "echo",
    "hemodynamic",
    "hypotension",
    "instability",
    "rv strain",
    "right ventricular",
    "shock",
    "syncope",
    "혈역학",
    "저혈압",
)
PE_IMAGING_PATHWAY_TERMS = (
    "bedside echo",
    "ct pulmonary angiography",
    "ctpa",
    "echo",
    "imaging",
    "v/q",
    "영상",
    "심초음파",
)
PE_BLEEDING_SAFETY_TERMS = (
    "bleeding",
    "recent surgery",
    "surgery",
    "thrombolysis",
    "출혈",
    "수술",
)
PE_RENAL_CONTRAST_SAFETY_TERMS = (
    "contrast",
    "creatinine",
    "egfr",
    "kidney",
    "renal",
    "조영제",
    "크레아티닌",
    "신장",
    "콩팥",
)
PE_PREGNANCY_SAFETY_TERMS = (
    "hcg",
    "pregnancy",
    "pregnant",
    "임신",
)
ACS_CONTEXT_TERMS = (
    "acute coronary syndrome",
    "acs",
    "myocardial infarction",
    "nstemi",
    "st-elevation",
    "stemi",
    "심근경색",
    "급성관상동맥",
)
ACS_ECG_ACTION_TERMS = (
    "12-lead ecg",
    "ecg",
    "electrocardiogram",
    "within 10 minutes",
    "심전도",
)
ACS_REPERFUSION_ACTION_TERMS = (
    "cath",
    "door-to-balloon",
    "door to balloon",
    "pci",
    "reperfusion",
    "stemi",
    "재관류",
)
ACS_ANTITHROMBOTIC_ACTION_TERMS = (
    "anticoagulation",
    "antiplatelet",
    "antithrombotic",
    "aspirin",
    "heparin",
    "항응고",
    "항혈소판",
)
ACS_DISSECTION_SAFETY_TERMS = (
    "aortic dissection",
    "dissection",
    "대동맥박리",
    "대동맥 박리",
)
ACS_BLEEDING_SAFETY_TERMS = (
    "active bleeding",
    "bleeding",
    "recent surgery",
    "surgery",
    "출혈",
    "수술",
)
ACS_HEMODYNAMIC_SAFETY_TERMS = (
    "cardiogenic shock",
    "hemodynamic",
    "heart failure",
    "hypotension",
    "instability",
    "pulmonary edema",
    "shock",
    "혈역학",
    "저혈압",
    "폐부종",
)


@dataclass
class CaseQualityReport:
    score: int = 100
    critical_issues: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.critical_issues and self.score >= MIN_PASSING_SCORE

    def add_critical(self, message: str, penalty: int = 15) -> None:
        self.critical_issues.append(message)
        self.score = max(0, self.score - penalty)

    def add_warning(self, message: str, penalty: int = 5) -> None:
        self.warnings.append(message)
        self.score = max(0, self.score - penalty)


@dataclass(frozen=True)
class DomainSafetyGate:
    name: str
    applies: Callable[[dict[str, Any]], bool]
    field_name: str
    validator: Callable[[list[Any]], bool]
    issue: str


def evaluate_case_quality(case: ClinicalCaseCreate | dict[str, Any]) -> CaseQualityReport:
    data = case.model_dump() if isinstance(case, ClinicalCaseCreate) else case
    report = CaseQualityReport()

    _check_required_narrative(data, report)
    _check_demographics(data, report)
    _check_vitals(data, report)
    _check_exam_sections(data, report)
    _check_deidentified_case_content(data, report)
    _check_diagnosis_not_visible_to_learner(data, report)
    _check_education_metadata(data, report)
    _check_safety_metadata(data, report)
    _check_source_metadata(data, report)
    _check_review_metadata(data, report)
    _check_coach_guidance(data, report)

    return report


def assert_case_quality(case: ClinicalCaseCreate | dict[str, Any]) -> None:
    report = evaluate_case_quality(case)
    if report.passed:
        return
    details = "; ".join(report.critical_issues + report.warnings)
    raise ValueError(f"Clinical case quality gate failed: {details}")


def _check_required_narrative(data: dict[str, Any], report: CaseQualityReport) -> None:
    required = [
        "title",
        "specialty",
        "difficulty",
        "chief_complaint",
        "history_of_present_illness",
        "past_medical_history",
        "diagnosis",
        "coach_guidance",
    ]
    for field_name in required:
        if not str(data.get(field_name, "")).strip():
            report.add_critical(f"missing {field_name}")


def _check_demographics(data: dict[str, Any], report: CaseQualityReport) -> None:
    demographics = data.get("patient_demographics") or {}
    age = demographics.get("age")
    sex = str(demographics.get("sex", "")).lower()
    if isinstance(age, int):
        if not 0 < age < 90:
            report.add_critical(
                "patient_demographics.age must be 1-89 or a 90+ age bucket"
            )
    elif not _is_older_adult_age_bucket(age):
        report.add_critical(
            "patient_demographics.age must be 1-89 or a 90+ age bucket"
        )
    if sex not in {"male", "female"}:
        report.add_critical("patient_demographics.sex must be male or female")
    if _is_pediatric_age(age):
        weight_kg = demographics.get("weight_kg")
        if not isinstance(weight_kg, (int, float)) or not 0.5 <= weight_kg <= 150:
            report.add_critical(
                "patient_demographics.weight_kg is required for pediatric cases"
            )


def _is_older_adult_age_bucket(age: Any) -> bool:
    if not isinstance(age, str):
        return False
    normalized = re.sub(r"\s+", " ", age.strip().lower())
    return normalized in {
        "90+",
        "90 or older",
        "90 years or older",
        "over 89",
        "older than 89",
    }


def _is_pediatric_age(age: Any) -> bool:
    return isinstance(age, int) and age < 18


def _check_vitals(data: dict[str, Any], report: CaseQualityReport) -> None:
    vitals = (data.get("physical_exam") or {}).get("vitals") or {}
    _check_blood_pressure(vitals.get("bp"), report)
    _check_range(vitals.get("hr"), 20, 250, "vitals.hr", report)
    _check_range(vitals.get("rr"), 4, 80, "vitals.rr", report)
    _check_range(vitals.get("temp_c"), 25, 45, "vitals.temp_c", report)
    _check_range(vitals.get("spo2"), 40, 100, "vitals.spo2", report)


def _check_blood_pressure(value: Any, report: CaseQualityReport) -> None:
    bp_text = str(value or "").strip()
    if not bp_text:
        report.add_critical("vitals.bp is required")
        return

    match = re.search(r"(?<!\d)(\d{2,3})\s*/\s*(\d{2,3})(?!\d)", bp_text)
    if not match:
        report.add_critical("vitals.bp must use systolic/diastolic numeric format")
        return

    systolic = int(match.group(1))
    diastolic = int(match.group(2))
    if not 50 <= systolic <= 260:
        report.add_critical("vitals.bp systolic must be between 50 and 260")
    if not 20 <= diastolic <= 160:
        report.add_critical("vitals.bp diastolic must be between 20 and 160")
    if systolic <= diastolic:
        report.add_critical("vitals.bp systolic must be greater than diastolic")


def _check_range(
    value: Any,
    lower: float,
    upper: float,
    label: str,
    report: CaseQualityReport,
) -> None:
    if not isinstance(value, (int, float)) or not lower <= value <= upper:
        report.add_critical(f"{label} must be between {lower:g} and {upper:g}")


def _check_exam_sections(data: dict[str, Any], report: CaseQualityReport) -> None:
    exam = data.get("physical_exam") or {}
    for section in ("general", "cardiovascular", "pulmonary", "abdomen", "neuro"):
        if not str(exam.get(section, "")).strip():
            report.add_critical(f"physical_exam.{section} is required")


def _check_deidentified_case_content(
    data: dict[str, Any],
    report: CaseQualityReport,
) -> None:
    case_text = "\n".join(_case_content_strings(data))
    detected_identifiers = detect_patient_identifiers(case_text)
    if detected_identifiers:
        report.add_critical(
            "case content must be de-identified; detected possible "
            f"patient identifiers: {', '.join(detected_identifiers)}"
        )


def _check_diagnosis_not_visible_to_learner(
    data: dict[str, Any],
    report: CaseQualityReport,
) -> None:
    diagnosis_terms = _diagnosis_leak_terms(str(data.get("diagnosis", "")))
    if not diagnosis_terms:
        return

    for label, text in _learner_visible_case_strings(data):
        normalized = _normalize_diagnosis_text(text)
        leaked_terms = [
            term
            for term in diagnosis_terms
            if _contains_diagnosis_term(normalized, term)
        ]
        if leaked_terms:
            report.add_critical(
                f"{label} must not reveal the diagnosis term '{leaked_terms[0]}'"
            )


def _learner_visible_case_strings(data: dict[str, Any]) -> list[tuple[str, str]]:
    strings = [
        (field_name, str(data.get(field_name)))
        for field_name in LEARNER_VISIBLE_CASE_TEXT_FIELDS
        if data.get(field_name)
    ]
    for field_name in ("medications",):
        for value in _nested_strings(data.get(field_name)):
            strings.append((field_name, value))
    for field_name in ("physical_exam", "initial_labs"):
        for value in _nested_strings(data.get(field_name)):
            strings.append((field_name, value))
    return strings


def _diagnosis_leak_terms(diagnosis: str) -> list[str]:
    normalized = _normalize_diagnosis_text(diagnosis)
    terms: set[str] = set()
    for trigger, aliases in DIAGNOSIS_LEAK_ALIASES.items():
        if trigger in normalized:
            terms.update(aliases)

    raw_tokens = re.findall(r"[a-z0-9]+", normalized)
    tokens = [
        token
        for token in raw_tokens
        if token not in DIAGNOSIS_LEAK_STOPWORDS
    ]
    acronym = "".join(
        token[0]
        for token in raw_tokens
        if token not in {"and", "or", "of", "the"}
    )
    if 3 <= len(acronym) <= 6:
        terms.add(acronym)

    for size in (3, 2):
        for index in range(0, max(0, len(tokens) - size + 1)):
            phrase_tokens = tokens[index:index + size]
            if all(len(token) >= 3 for token in phrase_tokens):
                terms.add(" ".join(phrase_tokens))

    for token in tokens:
        if token in DIAGNOSIS_SINGLE_TOKEN_LEAK_TERMS:
            terms.add(token)

    return sorted(terms, key=len, reverse=True)


def _normalize_diagnosis_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _contains_diagnosis_term(normalized_text: str, term: str) -> bool:
    escaped = re.escape(_normalize_diagnosis_text(term))
    return bool(re.search(rf"(?<![a-z0-9]){escaped}(?![a-z0-9])", normalized_text))


def _case_content_strings(data: dict[str, Any]) -> list[str]:
    text_fields = [
        "title",
        "chief_complaint",
        "history_of_present_illness",
        "past_medical_history",
        "diagnosis",
        "coach_guidance",
    ]
    strings = [
        str(data.get(field_name))
        for field_name in text_fields
        if data.get(field_name)
    ]
    for field_name in (
        "medications",
        "key_teaching_points",
        "cognitive_traps",
        "clinical_red_flags",
        "time_critical_actions",
        "contraindication_checks",
    ):
        strings.extend(_nested_strings(data.get(field_name)))
    for field_name in ("physical_exam", "initial_labs"):
        strings.extend(_nested_strings(data.get(field_name)))
    return strings


def _nested_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        strings: list[str] = []
        for item in value:
            strings.extend(_nested_strings(item))
        return strings
    if isinstance(value, dict):
        strings: list[str] = []
        for item in value.values():
            strings.extend(_nested_strings(item))
        return strings
    return []


def _check_education_metadata(data: dict[str, Any], report: CaseQualityReport) -> None:
    if len(data.get("key_teaching_points") or []) < 3:
        report.add_critical("at least 3 key teaching points are required")
    if len(data.get("cognitive_traps") or []) < 2:
        report.add_critical("at least 2 cognitive traps are required")


def _check_safety_metadata(data: dict[str, Any], report: CaseQualityReport) -> None:
    if len(data.get("clinical_red_flags") or []) < 2:
        report.add_critical("at least 2 clinical red flags are required")
    if len(data.get("time_critical_actions") or []) < 2:
        report.add_critical("at least 2 time-critical actions are required")
    if len(data.get("contraindication_checks") or []) < 2:
        report.add_critical("at least 2 contraindication checks are required")
    if (
        _requires_pregnancy_safety_check(data)
        and not _has_pregnancy_safety_check(data.get("contraindication_checks") or [])
    ):
        report.add_critical(
            "pregnancy status safety check is required for reproductive-age female cases"
        )
    if (
        _requires_pediatric_weight_safety_check(data)
        and not _has_pediatric_weight_safety_check(data.get("contraindication_checks") or [])
    ):
        report.add_critical(
            "weight-based dosing safety check is required for pediatric cases"
        )
    if (
        _requires_renal_safety_check(data)
        and not _has_renal_safety_check(data.get("contraindication_checks") or [])
    ):
        report.add_critical(
            "renal function safety check is required for contrast imaging or renally cleared therapy"
        )
    if (
        _requires_hemorrhage_safety_check(data)
        and not _has_hemorrhage_safety_check(data.get("contraindication_checks") or [])
    ):
        report.add_critical(
            "bleeding risk safety check is required for thrombolysis or antithrombotic therapy"
        )
    for gate in _domain_safety_gates():
        if gate.applies(data) and not gate.validator(data.get(gate.field_name) or []):
            report.add_critical(gate.issue)


def _domain_safety_gates() -> tuple[DomainSafetyGate, ...]:
    return (
        DomainSafetyGate(
            name="infection_time_critical_actions",
            applies=_requires_infection_treatment_safety_check,
            field_name="time_critical_actions",
            validator=_has_infection_time_critical_actions,
            issue=(
                "infection time-critical actions must include cultures and "
                "antimicrobial or source-control planning"
            ),
        ),
        DomainSafetyGate(
            name="infection_antimicrobial_safety",
            applies=_requires_infection_treatment_safety_check,
            field_name="contraindication_checks",
            validator=_has_antimicrobial_safety_check,
            issue=(
                "antimicrobial allergy and renal dosing safety checks are "
                "required for infection therapy"
            ),
        ),
        DomainSafetyGate(
            name="dka_time_critical_actions",
            applies=_requires_dka_treatment_safety_check,
            field_name="time_critical_actions",
            validator=_has_dka_time_critical_actions,
            issue=(
                "DKA time-critical actions must include potassium-before-insulin, "
                "fluids/insulin planning, and anion-gap or ketone closure monitoring"
            ),
        ),
        DomainSafetyGate(
            name="dka_contraindication_safety",
            applies=_requires_dka_treatment_safety_check,
            field_name="contraindication_checks",
            validator=_has_dka_contraindication_safety_check,
            issue=(
                "DKA safety checks must include potassium threshold and "
                "osmolar-shift or cerebral-edema risk before insulin therapy"
            ),
        ),
        DomainSafetyGate(
            name="stroke_time_critical_actions",
            applies=_requires_stroke_reperfusion_safety_check,
            field_name="time_critical_actions",
            validator=_has_stroke_time_critical_actions,
            issue=(
                "stroke time-critical actions must include last-known-normal "
                "timing, brain imaging, and reperfusion eligibility planning"
            ),
        ),
        DomainSafetyGate(
            name="stroke_reperfusion_safety",
            applies=_requires_stroke_reperfusion_safety_check,
            field_name="contraindication_checks",
            validator=_has_stroke_contraindication_safety_check,
            issue=(
                "stroke reperfusion safety checks must include hemorrhage "
                "exclusion, anticoagulant status, platelet count, glucose, and "
                "blood pressure thresholds"
            ),
        ),
        DomainSafetyGate(
            name="pe_time_critical_actions",
            applies=_requires_pe_safety_check,
            field_name="time_critical_actions",
            validator=_has_pe_time_critical_actions,
            issue=(
                "PE time-critical actions must include risk stratification, "
                "hemodynamic or RV-strain assessment, and imaging or bedside-echo "
                "pathway"
            ),
        ),
        DomainSafetyGate(
            name="pe_contraindication_safety",
            applies=_requires_pe_safety_check,
            field_name="contraindication_checks",
            validator=_has_pe_contraindication_safety_check,
            issue=(
                "PE safety checks must include bleeding or recent-surgery risk, "
                "renal/contrast safety, and pregnancy status when selecting imaging "
                "or anticoagulation"
            ),
        ),
        DomainSafetyGate(
            name="acs_time_critical_actions",
            applies=_requires_acs_safety_check,
            field_name="time_critical_actions",
            validator=_has_acs_time_critical_actions,
            issue=(
                "ACS time-critical actions must include ECG within 10 minutes, "
                "reperfusion pathway, and antithrombotic planning"
            ),
        ),
        DomainSafetyGate(
            name="acs_contraindication_safety",
            applies=_requires_acs_safety_check,
            field_name="contraindication_checks",
            validator=_has_acs_contraindication_safety_check,
            issue=(
                "ACS safety checks must include aortic dissection exclusion, "
                "bleeding or recent-surgery risk, and hemodynamic or heart-failure "
                "escalation"
            ),
        ),
    )


def _requires_pregnancy_safety_check(data: dict[str, Any]) -> bool:
    demographics = data.get("patient_demographics") or {}
    age = demographics.get("age")
    sex = str(demographics.get("sex", "")).strip().lower()
    return sex == "female" and isinstance(age, int) and 12 <= age <= 55


def _has_pregnancy_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    return any(term in normalized_checks for term in PREGNANCY_SAFETY_TERMS)


def _requires_pediatric_weight_safety_check(data: dict[str, Any]) -> bool:
    demographics = data.get("patient_demographics") or {}
    return _is_pediatric_age(demographics.get("age"))


def _has_pediatric_weight_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    return any(term in normalized_checks for term in PEDIATRIC_WEIGHT_SAFETY_TERMS)


def _requires_renal_safety_check(data: dict[str, Any]) -> bool:
    risk_text_fields = [
        "chief_complaint",
        "history_of_present_illness",
        "past_medical_history",
        "diagnosis",
        "coach_guidance",
    ]
    risk_text = " ".join(
        str(data.get(field_name, "")).lower()
        for field_name in risk_text_fields
    )
    for field_name in (
        "medications",
        "key_teaching_points",
        "time_critical_actions",
        "clinical_red_flags",
        "clinical_sources",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(_contains_safety_term(risk_text, term) for term in RENAL_RISK_TRIGGER_TERMS)


def _has_renal_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    return any(_contains_safety_term(normalized_checks, term) for term in RENAL_SAFETY_TERMS)


def _requires_hemorrhage_safety_check(data: dict[str, Any]) -> bool:
    risk_text_fields = [
        "diagnosis",
        "coach_guidance",
    ]
    risk_text = " ".join(
        str(data.get(field_name, "")).lower()
        for field_name in risk_text_fields
    )
    for field_name in (
        "key_teaching_points",
        "time_critical_actions",
        "clinical_sources",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in HIGH_RISK_THERAPY_TRIGGER_TERMS
    )


def _has_hemorrhage_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    return any(
        _contains_safety_term(normalized_checks, term)
        for term in HEMORRHAGE_SAFETY_TERMS
    )


def _requires_infection_treatment_safety_check(data: dict[str, Any]) -> bool:
    risk_text_fields = [
        "diagnosis",
        "coach_guidance",
    ]
    risk_text = " ".join(
        str(data.get(field_name, "")).lower()
        for field_name in risk_text_fields
    )
    for field_name in (
        "key_teaching_points",
        "time_critical_actions",
        "clinical_red_flags",
        "clinical_sources",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in INFECTION_TREATMENT_TRIGGER_TERMS
    )


def _has_infection_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_cultures = any(
        _contains_safety_term(normalized_actions, term)
        for term in INFECTION_CULTURE_TERMS
    )
    has_treatment = any(
        _contains_safety_term(normalized_actions, term)
        for term in INFECTION_TREATMENT_ACTION_TERMS
    )
    return has_cultures and has_treatment


def _has_antimicrobial_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_allergy_check = any(
        _contains_safety_term(normalized_checks, term)
        for term in ANTIMICROBIAL_ALLERGY_SAFETY_TERMS
    )
    has_dosing_check = any(
        _contains_safety_term(normalized_checks, term)
        for term in ANTIMICROBIAL_DOSING_SAFETY_TERMS
    )
    return has_allergy_check and has_dosing_check


def _requires_dka_treatment_safety_check(data: dict[str, Any]) -> bool:
    risk_text_fields = [
        "diagnosis",
        "coach_guidance",
    ]
    risk_text = " ".join(
        str(data.get(field_name, "")).lower()
        for field_name in risk_text_fields
    )
    for field_name in (
        "key_teaching_points",
        "time_critical_actions",
        "clinical_red_flags",
        "clinical_sources",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in DKA_TREATMENT_TRIGGER_TERMS
    )


def _has_dka_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_potassium = any(
        _contains_safety_term(normalized_actions, term)
        for term in DKA_POTASSIUM_ACTION_TERMS
    )
    has_fluid_insulin = any(
        _contains_safety_term(normalized_actions, term)
        for term in DKA_FLUID_INSULIN_ACTION_TERMS
    )
    has_closure_monitoring = any(
        _contains_safety_term(normalized_actions, term)
        for term in DKA_CLOSURE_MONITORING_TERMS
    )
    return has_potassium and has_fluid_insulin and has_closure_monitoring


def _has_dka_contraindication_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_potassium_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in DKA_POTASSIUM_SAFETY_TERMS
    )
    has_osmolar_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in DKA_OSMOLAR_SAFETY_TERMS
    )
    return has_potassium_safety and has_osmolar_safety


def _requires_stroke_reperfusion_safety_check(data: dict[str, Any]) -> bool:
    risk_text_fields = [
        "diagnosis",
        "coach_guidance",
    ]
    risk_text = " ".join(
        str(data.get(field_name, "")).lower()
        for field_name in risk_text_fields
    )
    for field_name in (
        "key_teaching_points",
        "time_critical_actions",
        "clinical_red_flags",
        "clinical_sources",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    has_stroke_context = any(
        _contains_safety_term(risk_text, term)
        for term in STROKE_CONTEXT_TERMS
    )
    has_reperfusion_context = any(
        _contains_safety_term(risk_text, term)
        for term in STROKE_REPERFUSION_TRIGGER_TERMS
    )
    return has_stroke_context and has_reperfusion_context


def _has_stroke_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_last_known_normal = any(
        _contains_safety_term(normalized_actions, term)
        for term in STROKE_LAST_KNOWN_NORMAL_TERMS
    )
    has_brain_imaging = any(
        _contains_safety_term(normalized_actions, term)
        for term in STROKE_BRAIN_IMAGING_TERMS
    )
    has_reperfusion_planning = any(
        _contains_safety_term(normalized_actions, term)
        for term in STROKE_REPERFUSION_ACTION_TERMS
    )
    return has_last_known_normal and has_brain_imaging and has_reperfusion_planning


def _has_stroke_contraindication_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_hemorrhage_exclusion = any(
        _contains_safety_term(normalized_checks, term)
        for term in STROKE_HEMORRHAGE_EXCLUSION_TERMS
    )
    has_anticoagulant_status = any(
        _contains_safety_term(normalized_checks, term)
        for term in STROKE_ANTICOAGULANT_SAFETY_TERMS
    )
    has_platelet_threshold = any(
        _contains_safety_term(normalized_checks, term)
        for term in STROKE_PLATELET_TERMS
    )
    has_glucose_threshold = any(
        _contains_safety_term(normalized_checks, term)
        for term in STROKE_GLUCOSE_TERMS
    )
    has_bp_threshold = any(
        _contains_safety_term(normalized_checks, term)
        for term in STROKE_BP_TERMS
    )
    return (
        has_hemorrhage_exclusion
        and has_anticoagulant_status
        and has_platelet_threshold
        and has_glucose_threshold
        and has_bp_threshold
    )


def _requires_pe_safety_check(data: dict[str, Any]) -> bool:
    risk_text_fields = [
        "chief_complaint",
        "history_of_present_illness",
        "past_medical_history",
        "diagnosis",
        "coach_guidance",
    ]
    risk_text = " ".join(
        str(data.get(field_name, "")).lower()
        for field_name in risk_text_fields
    )
    for field_name in (
        "key_teaching_points",
        "time_critical_actions",
        "clinical_red_flags",
        "clinical_sources",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(_contains_safety_term(risk_text, term) for term in PE_CONTEXT_TERMS)


def _has_pe_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_risk_stratification = any(
        _contains_safety_term(normalized_actions, term)
        for term in PE_RISK_STRATIFICATION_TERMS
    )
    has_hemodynamic_assessment = any(
        _contains_safety_term(normalized_actions, term)
        for term in PE_HEMODYNAMIC_TERMS
    )
    has_imaging_pathway = any(
        _contains_safety_term(normalized_actions, term)
        for term in PE_IMAGING_PATHWAY_TERMS
    )
    return has_risk_stratification and has_hemodynamic_assessment and has_imaging_pathway


def _has_pe_contraindication_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_bleeding_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in PE_BLEEDING_SAFETY_TERMS
    )
    has_renal_contrast_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in PE_RENAL_CONTRAST_SAFETY_TERMS
    )
    has_pregnancy_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in PE_PREGNANCY_SAFETY_TERMS
    )
    return has_bleeding_safety and has_renal_contrast_safety and has_pregnancy_safety


def _requires_acs_safety_check(data: dict[str, Any]) -> bool:
    if _requires_pe_safety_check(data) or _requires_stroke_reperfusion_safety_check(data):
        return False
    risk_text_fields = [
        "chief_complaint",
        "history_of_present_illness",
        "past_medical_history",
        "diagnosis",
        "coach_guidance",
    ]
    risk_text = " ".join(
        str(data.get(field_name, "")).lower()
        for field_name in risk_text_fields
    )
    for field_name in (
        "key_teaching_points",
        "time_critical_actions",
        "clinical_red_flags",
        "clinical_sources",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(_contains_safety_term(risk_text, term) for term in ACS_CONTEXT_TERMS)


def _has_acs_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_ecg = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACS_ECG_ACTION_TERMS
    )
    has_reperfusion = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACS_REPERFUSION_ACTION_TERMS
    )
    has_antithrombotic_planning = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACS_ANTITHROMBOTIC_ACTION_TERMS
    )
    return has_ecg and has_reperfusion and has_antithrombotic_planning


def _has_acs_contraindication_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_dissection_exclusion = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACS_DISSECTION_SAFETY_TERMS
    )
    has_bleeding_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACS_BLEEDING_SAFETY_TERMS
    )
    has_hemodynamic_escalation = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACS_HEMODYNAMIC_SAFETY_TERMS
    )
    return has_dissection_exclusion and has_bleeding_safety and has_hemodynamic_escalation


def _contains_safety_term(text: str, term: str) -> bool:
    normalized_term = term.lower()
    if normalized_term == "contrast":
        for match in re.finditer(r"(?<![a-z0-9])contrast(?![a-z0-9])", text):
            prefix = text[max(0, match.start() - 4):match.start()]
            if prefix not in {"non-", "non "}:
                return True
        return False
    if re.search(r"[^a-z0-9\s-]", normalized_term):
        return normalized_term in text
    return bool(
        re.search(rf"(?<![a-z0-9]){re.escape(normalized_term)}(?![a-z0-9])", text)
    )


def _check_source_metadata(data: dict[str, Any], report: CaseQualityReport) -> None:
    sources = data.get("clinical_sources") or []
    if not sources:
        report.add_critical("at least 1 clinical source is required")
        return
    source_organizations: set[str] = set()
    support_texts: list[str] = []
    for index, source in enumerate(sources):
        if not isinstance(source, dict):
            report.add_critical(f"clinical_sources[{index}] must be an object")
            continue
        missing = [
            key
            for key in ("title", "organization", "url", "supports")
            if not source.get(key)
        ]
        if missing:
            report.add_critical(
                f"clinical_sources[{index}] missing {', '.join(missing)}"
            )
            continue
        organization = str(source.get("organization") or "").strip().lower()
        if organization:
            source_organizations.add(organization)
        _check_source_url(index, str(source["url"]), report)
        supports = source.get("supports")
        valid_supports = [
            item
            for item in supports or []
            if isinstance(item, str) and item.strip()
        ] if isinstance(supports, list) else []
        if len(valid_supports) < 2:
            report.add_critical(
                f"clinical_sources[{index}] must list at least 2 supported case elements"
            )
            continue
        support_texts.extend(valid_supports)
    if (
        data.get("review_status") == "clinician_reviewed"
        and len(source_organizations) < MIN_REVIEWED_SOURCE_ORGANIZATIONS
    ):
        report.add_critical(
            "clinician_reviewed cases require at least 2 independent clinical "
            "source organizations"
        )
    _check_source_support_scope(support_texts, report)
    _check_source_support_item_coverage(data, support_texts, report)


def _check_source_support_scope(
    support_texts: list[str],
    report: CaseQualityReport,
) -> None:
    support_blob = " ".join(support_texts).lower()
    for scope, patterns in SOURCE_SUPPORT_SCOPE_PATTERNS.items():
        if any(re.search(pattern, support_blob) for pattern in patterns):
            continue
        report.add_critical(
            f"clinical_sources.supports must include support for {scope}"
        )


def _check_source_support_item_coverage(
    data: dict[str, Any],
    support_texts: list[str],
    report: CaseQualityReport,
) -> None:
    support_token_sets = []
    for text in support_texts:
        support_tokens = _tokens_for_source_support(text)
        if support_tokens:
            support_token_sets.append(support_tokens)
    if not support_token_sets:
        return
    for field_name, label in SOURCE_SUPPORT_COVERAGE_FIELDS.items():
        for item in data.get(field_name) or []:
            item_text = str(item).strip()
            if not item_text:
                continue
            item_tokens = _tokens_for_source_support(item_text)
            if not item_tokens:
                continue
            required_overlap = 1 if len(item_tokens) <= 2 else 2
            if any(
                len(item_tokens.intersection(support_tokens)) >= required_overlap
                for support_tokens in support_token_sets
            ):
                continue
            report.add_critical(
                f"clinical_sources.supports must specifically anchor {label}: "
                f"{item_text[:120]}"
            )


def _tokens_for_source_support(text: str) -> set[str]:
    tokens: set[str] = set()
    normalized = text.lower()
    phrase_aliases = {
        "blood pressure": {"blood_pressure", "bp"},
        "ct pulmonary angiography": {"ctpa", "contrast", "imaging"},
        "door to balloon": {"door_to_balloon", "reperfusion"},
        "door-to-balloon": {"door_to_balloon", "reperfusion"},
        "heart failure": {"heart_failure", "pulmonary_edema"},
        "last known normal": {"last_known_normal", "lkn"},
        "mental status": {"mental_status", "confusion"},
        "pulmonary edema": {"pulmonary_edema", "heart_failure"},
        "right heart strain": {"rv_strain", "strain"},
        "right ventricular": {"rv", "rv_strain"},
    }
    for phrase, aliases in phrase_aliases.items():
        if phrase in normalized:
            tokens.update(aliases)
    for token in re.findall(r"[a-z0-9]+", normalized):
        if len(token) < 3 and token not in {"bp", "ct", "pe"}:
            continue
        token = SOURCE_SUPPORT_TOKEN_ALIASES.get(token, token)
        if token not in SOURCE_SUPPORT_STOPWORDS:
            tokens.add(token)
    return tokens


def _check_source_url(index: int, url: str, report: CaseQualityReport) -> None:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not hostname:
        report.add_critical(f"clinical_sources[{index}].url must be a valid HTTPS URL")
        return
    if (
        hostname in PLACEHOLDER_SOURCE_HOSTS
        or hostname.endswith(".example")
        or any(hostname.endswith(f".{host}") for host in PLACEHOLDER_SOURCE_HOSTS)
    ):
        report.add_critical(
            f"clinical_sources[{index}].url must not use a placeholder source domain"
        )
        return
    if not _is_trusted_clinical_source_host(hostname):
        report.add_critical(
            f"clinical_sources[{index}].url must use a reputable clinical source domain"
        )


def _is_trusted_clinical_source_host(hostname: str) -> bool:
    normalized = hostname.removeprefix("www.")
    if any(normalized.endswith(suffix) for suffix in TRUSTED_CLINICAL_SOURCE_SUFFIXES):
        return True
    return any(
        normalized == trusted_host or normalized.endswith(f".{trusted_host}")
        for trusted_host in TRUSTED_CLINICAL_SOURCE_HOSTS
    )


def _check_review_metadata(data: dict[str, Any], report: CaseQualityReport) -> None:
    status = data.get("review_status")
    last_reviewed_at = data.get("last_reviewed_at")
    if status not in ALLOWED_REVIEW_STATUSES:
        report.add_critical("review_status is not recognized")
    if status == "clinician_reviewed" and not last_reviewed_at:
        report.add_critical("clinician_reviewed cases require last_reviewed_at")
    if status == "educational_draft" and not last_reviewed_at:
        report.add_warning("educational_draft cases should include last_reviewed_at")
    if not last_reviewed_at:
        return
    try:
        reviewed_on = date.fromisoformat(str(last_reviewed_at)[:10])
    except ValueError:
        report.add_critical("last_reviewed_at must be a valid ISO date")
        return
    if reviewed_on > date.today():
        report.add_critical("last_reviewed_at must not be in the future")


def _check_coach_guidance(data: dict[str, Any], report: CaseQualityReport) -> None:
    guidance = str(data.get("coach_guidance", "")).lower()
    if "reveal" in guidance and "diagnosis" in guidance:
        report.add_critical("coach_guidance must not instruct revealing the diagnosis")
    if "tell the student" in guidance and "diagnosis" in guidance:
        report.add_critical("coach_guidance must not tell the student the diagnosis")
