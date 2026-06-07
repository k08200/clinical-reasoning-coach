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

from app.models.case import MIN_REVIEWED_SOURCE_ORGANIZATIONS
from app.schemas.case import ClinicalCaseCreate
from app.services.privacy_guard import detect_patient_identifiers

MIN_PASSING_SCORE = 85
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
DIAGNOSIS_KOREAN_SINGLE_TOKEN_LEAK_TERMS = {
    "기흉",
    "뇌경색",
    "뇌졸중",
    "담관염",
    "담낭염",
    "수막염",
    "심근경색",
    "심근염",
    "심낭염",
    "신우신염",
    "췌장염",
    "충수염",
    "케톤산증",
    "폐렴",
    "폐색전",
    "폐색전증",
    "패혈증",
    "요로패혈증",
    "아나필락시스",
}
DIAGNOSIS_LEAK_ALIASES = {
    "acute coronary syndrome": ["acute coronary syndrome", "acs"],
    "급성 관상동맥 증후군": [
        "급성 관상동맥 증후군",
        "급성관상동맥증후군",
        "관상동맥 증후군",
        "관상동맥증후군",
        "심근경색",
    ],
    "myocardial infarction": ["myocardial infarction", "heart attack"],
    "심근경색": [
        "심근경색",
        "심근 경색",
        "급성 관상동맥 증후군",
        "급성관상동맥증후군",
    ],
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
    "패혈성 쇼크": ["패혈성 쇼크", "패혈성쇼크", "패혈증", "요로패혈증"],
    "pulmonary embolism": ["pulmonary embolism", "embolism"],
    "폐색전증": ["폐색전증", "폐색전"],
    "diabetic ketoacidosis": ["diabetic ketoacidosis", "ketoacidosis", "dka"],
    "당뇨병성 케톤산증": [
        "당뇨병성 케톤산증",
        "당뇨병성케톤산증",
        "케톤산증",
    ],
    "acute ischemic stroke": ["acute ischemic stroke", "ischemic stroke"],
    "급성 허혈성 뇌졸중": [
        "급성 허혈성 뇌졸중",
        "급성허혈성뇌졸중",
        "허혈성 뇌졸중",
        "허혈성뇌졸중",
        "뇌경색",
        "뇌졸중",
    ],
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
SEPSIS_CONTEXT_TERMS = (
    "sepsis",
    "sepsis bundle",
    "septic",
    "septic shock",
    "urosepsis",
    "패혈증",
)
SEPSIS_LACTATE_ACTION_TERMS = (
    "lactate",
    "젖산",
)
SEPSIS_FLUID_ACTION_TERMS = (
    "fluid",
    "fluids",
    "resuscitation",
    "수액",
)
SEPSIS_VASOPRESSOR_ACTION_TERMS = (
    "hypotension persists",
    "map",
    "norepinephrine",
    "pressor",
    "pressors",
    "shock",
    "vasopressor",
    "vasopressors",
    "노르에피네프린",
    "승압제",
    "저혈압",
    "혈관수축제",
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
ANAPHYLAXIS_CONTEXT_TERMS = (
    "anaphylaxis",
    "anaphylactic",
    "anaphylactic shock",
    "angioedema",
    "urticaria with wheeze",
    "wheeze with hypotension",
    "아나필락시스",
    "혈관부종",
)
ANAPHYLAXIS_EPINEPHRINE_ACTION_TERMS = (
    "adrenaline",
    "epi",
    "epinephrine",
    "im adrenaline",
    "im epinephrine",
    "intramuscular adrenaline",
    "intramuscular epinephrine",
    "아드레날린",
    "에피네프린",
)
ANAPHYLAXIS_AIRWAY_ACTION_TERMS = (
    "airway",
    "bronchospasm",
    "intubation",
    "oxygen",
    "stridor",
    "wheeze",
    "기도",
    "기관삽관",
    "산소",
    "천명",
    "호흡",
)
ANAPHYLAXIS_SHOCK_ACTION_TERMS = (
    "fluid",
    "fluid bolus",
    "hypotension",
    "resuscitation",
    "shock",
    "vasopressor",
    "쇼크",
    "수액",
    "저혈압",
)
ANAPHYLAXIS_TRIGGER_SAFETY_TERMS = (
    "allergen",
    "allergy",
    "exposure",
    "remove",
    "stop infusion",
    "trigger",
    "노출",
    "알레르겐",
    "중단",
    "항원",
)
ANAPHYLAXIS_OBSERVATION_SAFETY_TERMS = (
    "biphasic",
    "monitoring",
    "observation",
    "observe",
    "recurrence",
    "rebound",
    "모니터링",
    "이상성",
    "재발",
    "관찰",
)
GI_BLEED_CONTEXT_TERMS = (
    "acute blood loss anemia",
    "gastrointestinal bleeding",
    "gi bleed",
    "hematemesis",
    "hemorrhagic shock",
    "melena",
    "upper gi bleed",
    "variceal bleeding",
    "위장관 출혈",
    "토혈",
    "흑색변",
)
GI_BLEED_RESUSCITATION_ACTION_TERMS = (
    "fluid",
    "fluid resuscitation",
    "hemodynamic",
    "large bore iv",
    "large-bore iv",
    "resuscitation",
    "shock",
    "two large bore",
    "two large-bore",
    "수액",
    "정맥로",
    "혈역학",
)
GI_BLEED_BLOOD_PREP_ACTION_TERMS = (
    "blood products",
    "crossmatch",
    "cross-match",
    "massive transfusion",
    "packed rbc",
    "prbc",
    "transfusion",
    "type and cross",
    "type and screen",
    "교차시험",
    "수혈",
    "혈액형",
)
GI_BLEED_SOURCE_CONTROL_ACTION_TERMS = (
    "endoscopy",
    "gastroenterology",
    "gi consult",
    "hemostasis",
    "source control",
    "urgent endoscopy",
    "내시경",
    "소화기",
    "지혈",
)
GI_BLEED_REVERSAL_SAFETY_TERMS = (
    "anticoagulant",
    "anticoagulation",
    "antiplatelet",
    "coagulopathy",
    "doac",
    "inr",
    "platelet",
    "reversal",
    "warfarin",
    "와파린",
    "응고",
    "항응고",
    "항혈소판",
    "혈소판",
)
GI_BLEED_TRANSFUSION_SAFETY_TERMS = (
    "blood type",
    "consent",
    "crossmatch",
    "cross-match",
    "transfusion reaction",
    "type and screen",
    "교차시험",
    "동의",
    "수혈 반응",
    "수혈반응",
    "혈액형",
)
CNS_INFECTION_CONTEXT_TERMS = (
    "bacterial meningitis",
    "meningitis",
    "meningococcemia",
    "meningococcal",
    "수막염",
    "뇌수막염",
    "중추신경계 감염",
)
CNS_INFECTION_CULTURE_ACTION_TERMS = (
    "blood culture",
    "blood cultures",
    "culture",
    "cultures",
    "배양",
    "혈액배양",
    "혈액 배양",
)
CNS_INFECTION_ANTIBIOTIC_ACTION_TERMS = (
    "antibiotic",
    "antibiotics",
    "antimicrobial",
    "antimicrobials",
    "ceftriaxone",
    "empiric",
    "vancomycin",
    "항균제",
    "항생제",
)
CNS_INFECTION_LP_CT_ACTION_TERMS = (
    "ct before lp",
    "head ct",
    "lp",
    "lumbar puncture",
    "neuroimaging",
    "spinal tap",
    "뇌영상",
    "요추천자",
)
CNS_INFECTION_STEROID_ACTION_TERMS = (
    "dexamethasone",
    "steroid",
    "steroids",
    "덱사메타손",
    "스테로이드",
)
CNS_INFECTION_ANTIMICROBIAL_SAFETY_TERMS = (
    "allergies",
    "allergy",
    "creatinine",
    "dose",
    "dosing",
    "egfr",
    "kidney",
    "renal",
    "vancomycin",
    "신장",
    "알레르기",
    "용량",
    "콩팥",
    "크레아티닌",
)
CNS_INFECTION_LP_SAFETY_TERMS = (
    "anticoagulant",
    "coagulopathy",
    "ct before lp",
    "focal neurologic deficit",
    "head ct",
    "increased intracranial pressure",
    "lp contraindication",
    "mass lesion",
    "papilledema",
    "platelet",
    "요추천자",
    "응고",
    "항응고",
    "혈소판",
)
CNS_INFECTION_STEROID_SAFETY_TERMS = (
    "before antibiotics",
    "before or with antibiotics",
    "dexamethasone",
    "steroid",
    "steroids",
    "덱사메타손",
    "스테로이드",
)
ECTOPIC_PREGNANCY_CONTEXT_TERMS = (
    "ectopic pregnancy",
    "pregnancy of unknown location",
    "pregnant with abdominal pain",
    "pregnant with pelvic pain",
    "pregnant with syncope",
    "pregnant with vaginal bleeding",
    "ruptured ectopic",
    "tubal pregnancy",
    "자궁외임신",
    "자궁외 임신",
)
ECTOPIC_PREGNANCY_HCG_ACTION_TERMS = (
    "beta hcg",
    "beta-hcg",
    "hcg",
    "pregnancy test",
    "quantitative hcg",
    "β-hcg",
    "임신반응",
    "임신 검사",
)
ECTOPIC_PREGNANCY_ULTRASOUND_ACTION_TERMS = (
    "pelvic ultrasound",
    "transvaginal ultrasound",
    "tvu",
    "tvus",
    "ultrasound",
    "초음파",
    "질식초음파",
)
ECTOPIC_PREGNANCY_ESCALATION_ACTION_TERMS = (
    "emergency surgery",
    "gynecology",
    "hemodynamic",
    "ob consult",
    "ob/gyn",
    "obgyn",
    "operative",
    "rupture",
    "surgery",
    "unstable",
    "산부인과",
    "수술",
    "파열",
    "혈역학",
)
ECTOPIC_PREGNANCY_RH_SAFETY_TERMS = (
    "anti-d",
    "blood type",
    "rh",
    "rhesus",
    "혈액형",
)
ECTOPIC_PREGNANCY_MTX_SAFETY_TERMS = (
    "breastfeeding",
    "cbc",
    "liver",
    "methotrexate",
    "renal",
    "rupture",
    "unstable",
    "간기능",
    "메토트렉세이트",
    "신장",
    "파열",
)
ECTOPIC_PREGNANCY_HEMODYNAMIC_SAFETY_TERMS = (
    "hemodynamic",
    "hemoperitoneum",
    "hypotension",
    "peritoneal",
    "shock",
    "syncope",
    "unstable",
    "복막",
    "실신",
    "저혈압",
    "혈역학",
)
SEVERE_PREECLAMPSIA_CONTEXT_TERMS = (
    "eclampsia",
    "postpartum preeclampsia",
    "preeclampsia with severe features",
    "severe pre-eclampsia",
    "severe preeclampsia",
    "severe-range blood pressure in pregnancy",
    "severe hypertension in pregnancy",
    "임신중독증",
    "전자간증",
    "자간증",
)
SEVERE_PREECLAMPSIA_MAGNESIUM_ACTION_TERMS = (
    "magnesium",
    "magnesium sulfate",
    "mgso4",
    "seizure prophylaxis",
    "seizure treatment",
    "황산마그네슘",
)
SEVERE_PREECLAMPSIA_ANTIHYPERTENSIVE_ACTION_TERMS = (
    "acute severe hypertension",
    "antihypertensive",
    "blood pressure",
    "hydralazine",
    "labetalol",
    "nifedipine",
    "severe-range",
    "혈압",
)
SEVERE_PREECLAMPSIA_DELIVERY_ACTION_TERMS = (
    "antenatal corticosteroid",
    "delivery",
    "fetal",
    "maternal-fetal",
    "obstetric",
    "placenta",
    "stabilize",
    "분만",
    "태아",
)
SEVERE_PREECLAMPSIA_ESCALATION_ACTION_TERMS = (
    "consult",
    "critical care",
    "eclampsia",
    "icu",
    "maternal-fetal medicine",
    "obstetric",
    "pulmonary edema",
    "seizure",
    "중환자",
)
SEVERE_PREECLAMPSIA_MAGNESIUM_TOX_SAFETY_TERMS = (
    "calcium gluconate",
    "deep tendon reflex",
    "magnesium toxicity",
    "respiratory depression",
    "respiratory rate",
    "urine output",
    "반사",
    "소변",
)
SEVERE_PREECLAMPSIA_BP_MED_SAFETY_TERMS = (
    "asthma",
    "bradycardia",
    "heart failure",
    "hypotension",
    "labetalol",
    "nifedipine",
    "혈압",
)
SEVERE_PREECLAMPSIA_LAB_ORGAN_SAFETY_TERMS = (
    "alt",
    "ast",
    "creatinine",
    "hellp",
    "liver",
    "platelet",
    "proteinuria",
    "renal",
    "간",
    "신장",
    "혈소판",
)
SEVERE_PREECLAMPSIA_MATERNAL_FETAL_SAFETY_TERMS = (
    "abruption",
    "fetal",
    "gestational age",
    "headache",
    "pulmonary edema",
    "right upper quadrant",
    "seizure",
    "visual",
    "태아",
    "폐부종",
)
HYPERTENSIVE_EMERGENCY_DIRECT_CONTEXT_TERMS = (
    "hypertensive emergency",
    "hypertensive encephalopathy",
    "hypertensive pulmonary edema",
    "malignant hypertension",
    "severe hypertension with acute kidney injury",
    "severe hypertension with end-organ damage",
    "severe hypertension with organ damage",
    "고혈압 응급",
)
HYPERTENSIVE_EMERGENCY_BP_CONTEXT_TERMS = (
    "bp 180",
    "bp 200",
    "blood pressure 180",
    "blood pressure 200",
    "dbp 120",
    "sbp 180",
    "sbp 200",
    "severe hypertension",
    "severely elevated blood pressure",
    "수축기 180",
    "혈압 180",
)
HYPERTENSIVE_EMERGENCY_ORGAN_CONTEXT_TERMS = (
    "acute kidney injury",
    "acute pulmonary edema",
    "aortic dissection",
    "chest pain",
    "encephalopathy",
    "end-organ damage",
    "heart failure",
    "myocardial ischemia",
    "neurologic deficit",
    "papilledema",
    "renal failure",
    "retinal hemorrhage",
    "seizure",
    "target-organ damage",
    "뇌병증",
    "장기 손상",
)
HYPERTENSIVE_EMERGENCY_BP_CONFIRM_MONITOR_ACTION_TERMS = (
    "arterial line",
    "blood pressure confirmation",
    "continuous bp",
    "icu",
    "monitored setting",
    "repeat bp",
    "repeat blood pressure",
    "telemetry",
    "반복 혈압",
    "중환자",
)
HYPERTENSIVE_EMERGENCY_ORGAN_ASSESSMENT_ACTION_TERMS = (
    "aki",
    "aortic dissection",
    "chest x-ray",
    "creatinine",
    "ct head",
    "ecg",
    "encephalopathy",
    "fundoscopic",
    "neurologic",
    "pulmonary edema",
    "renal",
    "troponin",
    "urinalysis",
    "장기 손상",
)
HYPERTENSIVE_EMERGENCY_IV_TREATMENT_ACTION_TERMS = (
    "clevidipine",
    "esmolol",
    "fenoldopam",
    "iv antihypertensive",
    "iv labetalol",
    "labetalol",
    "nicardipine",
    "nitroglycerin",
    "nitroprusside",
    "titrated infusion",
    "정맥",
)
HYPERTENSIVE_EMERGENCY_BP_TARGET_ACTION_TERMS = (
    "20 to 25%",
    "20-25%",
    "25%",
    "first hour",
    "gradual",
    "map",
    "mean arterial pressure",
    "not abruptly",
    "첫 1시간",
)
HYPERTENSIVE_EMERGENCY_URGENCY_DIFFERENTIATION_SAFETY_TERMS = (
    "asymptomatic",
    "markedly elevated",
    "no acute target-organ damage",
    "not emergency",
    "urgency",
    "무증상",
)
HYPERTENSIVE_EMERGENCY_OVERLOWERING_SAFETY_TERMS = (
    "avoid rapid",
    "cerebral hypoperfusion",
    "gradual",
    "hypoperfusion",
    "hypotension",
    "no more than 25%",
    "not abruptly",
    "overcorrection",
    "과교정",
)
HYPERTENSIVE_EMERGENCY_CONDITION_MED_SAFETY_TERMS = (
    "aortic dissection",
    "asthma",
    "beta blocker",
    "bradycardia",
    "heart failure",
    "ischemic stroke",
    "pregnancy",
    "pulmonary edema",
    "renal failure",
    "stroke",
    "금기",
)
HYPERTENSIVE_EMERGENCY_DISPOSITION_SAFETY_TERMS = (
    "arterial line",
    "continuous",
    "icu",
    "monitored",
    "reassessment",
    "telemetry",
    "titration",
    "중환자",
)
GIANT_CELL_ARTERITIS_DIRECT_CONTEXT_TERMS = (
    "cranial arteritis",
    "gca",
    "giant cell arteritis",
    "temporal arteritis",
    "거대세포동맥염",
    "측두동맥염",
)
GIANT_CELL_ARTERITIS_HEADACHE_CONTEXT_TERMS = (
    "new headache",
    "scalp tenderness",
    "temporal artery tenderness",
    "temporal headache",
    "temporal pain",
    "두통",
    "측두",
)
GIANT_CELL_ARTERITIS_ISCHEMIC_CONTEXT_TERMS = (
    "amaurosis fugax",
    "diplopia",
    "jaw claudication",
    "transient vision loss",
    "visual disturbance",
    "vision loss",
    "시력",
    "턱",
)
GIANT_CELL_ARTERITIS_STEROID_ACTION_TERMS = (
    "corticosteroid",
    "glucocorticoid",
    "high-dose prednisone",
    "iv methylprednisolone",
    "methylprednisolone",
    "prednisone",
    "prednisolone",
    "steroid",
    "스테로이드",
)
GIANT_CELL_ARTERITIS_LAB_ACTION_TERMS = (
    "cbc",
    "crp",
    "erythrocyte sedimentation rate",
    "esr",
    "inflammatory marker",
    "platelet",
    "혈소판",
)
GIANT_CELL_ARTERITIS_DIAGNOSTIC_ACTION_TERMS = (
    "biopsy",
    "color doppler",
    "halo sign",
    "temporal artery biopsy",
    "temporal artery ultrasound",
    "ultrasound",
    "초음파",
    "생검",
)
GIANT_CELL_ARTERITIS_ESCALATION_ACTION_TERMS = (
    "emergency",
    "ophthalmology",
    "rheumatology",
    "same-day",
    "urgent referral",
    "vision loss",
    "visual symptom",
    "응급",
    "안과",
    "류마티스",
)
GIANT_CELL_ARTERITIS_DO_NOT_DELAY_SAFETY_TERMS = (
    "before biopsy",
    "do not delay",
    "do not wait",
    "immediate",
    "not delay",
    "same day",
    "지연",
    "즉시",
)
GIANT_CELL_ARTERITIS_VISION_ISCHEMIA_SAFETY_TERMS = (
    "amaurosis fugax",
    "cranial ischemia",
    "diplopia",
    "stroke",
    "visual disturbance",
    "vision loss",
    "시력",
)
GIANT_CELL_ARTERITIS_STEROID_RISK_SAFETY_TERMS = (
    "bone protection",
    "diabetes",
    "fracture",
    "glucose",
    "infection",
    "osteoporosis",
    "ppi",
    "steroid toxicity",
    "위장",
    "혈당",
)
GIANT_CELL_ARTERITIS_FOLLOWUP_SAFETY_TERMS = (
    "large vessel",
    "polymyalgia rheumatica",
    "relapse",
    "taper",
    "tocilizumab",
    "vascular imaging",
    "follow-up",
    "추적",
)
ACUTE_ANGLE_CLOSURE_GLAUCOMA_DIRECT_CONTEXT_TERMS = (
    "acute angle closure",
    "acute angle-closure glaucoma",
    "acute closed-angle glaucoma",
    "angle closure glaucoma",
    "angle-closure glaucoma",
    "closed-angle glaucoma",
    "급성 폐쇄각 녹내장",
)
ACUTE_ANGLE_CLOSURE_GLAUCOMA_RED_EYE_CONTEXT_TERMS = (
    "painful red eye",
    "red eye",
    "severe eye pain",
    "안구 통증",
    "충혈",
)
ACUTE_ANGLE_CLOSURE_GLAUCOMA_ANGLE_CONTEXT_TERMS = (
    "fixed mid-dilated pupil",
    "halos",
    "intraocular pressure",
    "iop",
    "mid-dilated pupil",
    "nausea",
    "shallow anterior chamber",
    "vomiting",
    "안압",
    "동공",
)
ACUTE_ANGLE_CLOSURE_GLAUCOMA_IOP_ASSESSMENT_ACTION_TERMS = (
    "gonioscopy",
    "intraocular pressure",
    "iop",
    "slit lamp",
    "tonometry",
    "안압",
)
ACUTE_ANGLE_CLOSURE_GLAUCOMA_AQUEOUS_SUPPRESSANT_ACTION_TERMS = (
    "apraclonidine",
    "beta blocker",
    "brimonidine",
    "dorzolamide",
    "timolol",
    "topical",
    "점안",
)
ACUTE_ANGLE_CLOSURE_GLAUCOMA_SYSTEMIC_IOP_ACTION_TERMS = (
    "acetazolamide",
    "diamox",
    "glycerol",
    "isosorbide",
    "mannitol",
    "osmotic",
    "systemic",
    "아세타졸아마이드",
)
ACUTE_ANGLE_CLOSURE_GLAUCOMA_DEFINITIVE_ACTION_TERMS = (
    "iridectomy",
    "iridotomy",
    "laser peripheral iridotomy",
    "lpi",
    "ophthalmology",
    "urgent ophthalmology",
    "안과",
    "홍채절개",
)
ACUTE_ANGLE_CLOSURE_GLAUCOMA_MED_CONTRA_SAFETY_TERMS = (
    "acetazolamide allergy",
    "asthma",
    "bradycardia",
    "copd",
    "renal failure",
    "sulfa allergy",
    "timolol",
    "금기",
)
ACUTE_ANGLE_CLOSURE_GLAUCOMA_PILOCARPINE_SAFETY_TERMS = (
    "avoid pilocarpine",
    "corneal edema",
    "defer pilocarpine",
    "high iop",
    "lens-induced",
    "pilocarpine",
    "phacomorphic",
    "pupil block",
    "필로카르핀",
)
ACUTE_ANGLE_CLOSURE_GLAUCOMA_FELLOW_EYE_SAFETY_TERMS = (
    "bilateral",
    "both eyes",
    "fellow eye",
    "prophylactic iridotomy",
    "second eye",
    "양안",
)
ACUTE_ANGLE_CLOSURE_GLAUCOMA_MONITORING_SAFETY_TERMS = (
    "corneal edema",
    "optic nerve",
    "recheck iop",
    "repeat iop",
    "visual acuity",
    "vision loss",
    "시력",
    "안압 재측정",
)
NEUTROPENIC_FEVER_CONTEXT_TERMS = (
    "absolute neutrophil count",
    "anc below 500",
    "febrile neutropenia",
    "neutropenic fever",
    "neutropenic sepsis",
    "neutropenic patient with fever",
    "post-chemotherapy fever",
    "호중구감소",
    "호중구감소증",
)
NEUTROPENIC_FEVER_ANC_ACTION_TERMS = (
    "absolute neutrophil",
    "anc",
    "cbc",
    "full blood count",
    "neutrophil count",
    "백혈구",
    "호중구",
)
NEUTROPENIC_FEVER_CULTURE_ACTION_TERMS = (
    "blood culture",
    "central line culture",
    "culture",
    "cultures",
    "peripheral culture",
    "source",
    "urinalysis",
    "배양",
)
NEUTROPENIC_FEVER_ANTIPSEUDOMONAL_ACTION_TERMS = (
    "anti-pseudomonal",
    "antipseudomonal",
    "broad-spectrum antibiotic",
    "cefepime",
    "ceftazidime",
    "empiric antibiotic",
    "meropenem",
    "piperacillin",
    "tazobactam",
    "within 1 hour",
    "항생제",
)
NEUTROPENIC_FEVER_ESCALATION_ACTION_TERMS = (
    "admit",
    "cisne",
    "hematology",
    "icu",
    "mascc",
    "oncology",
    "risk score",
    "risk stratification",
    "sepsis",
    "입원",
    "혈액",
    "종양",
)
NEUTROPENIC_FEVER_ANTIBIOTIC_SAFETY_TERMS = (
    "allergy",
    "antibiogram",
    "creatinine",
    "hepatic",
    "kidney",
    "liver",
    "renal",
    "toxicity",
    "간",
    "신장",
)
NEUTROPENIC_FEVER_CATHETER_RESISTANCE_SAFETY_TERMS = (
    "catheter",
    "central line",
    "gram-positive",
    "local microbiology",
    "mrsa",
    "pneumonia",
    "resistant",
    "skin",
    "soft tissue",
    "vancomycin",
    "중심정맥",
)
NEUTROPENIC_FEVER_RISK_DISPOSITION_SAFETY_TERMS = (
    "cisne",
    "comorbidity",
    "discharge",
    "high risk",
    "low risk",
    "mascc",
    "outpatient",
    "return precautions",
    "risk score",
    "social",
    "퇴원",
)
NEUTROPENIC_FEVER_REASSESSMENT_SAFETY_TERMS = (
    "antifungal",
    "deterioration",
    "fungal",
    "persistent fever",
    "reassess",
    "reassessment",
    "resistant",
    "72 hours",
    "재평가",
)
OBSTRUCTIVE_PYELONEPHRITIS_COMBINED_CONTEXT_TERMS = (
    "infected obstructing stone",
    "infected obstructive uropathy",
    "infected ureteral stone",
    "obstructed infected kidney",
    "obstructive pyelonephritis",
    "pyelonephritis with obstruction",
    "septic obstructive uropathy",
    "stone sepsis",
    "urosepsis with hydronephrosis",
    "폐쇄성 신우신염",
)
OBSTRUCTIVE_PYELONEPHRITIS_INFECTION_CONTEXT_TERMS = (
    "fever",
    "infected",
    "pyelonephritis",
    "rigor",
    "sepsis",
    "septic shock",
    "urinary tract infection",
    "uti",
    "urosepsis",
    "발열",
    "신우신염",
)
OBSTRUCTIVE_PYELONEPHRITIS_OBSTRUCTION_CONTEXT_TERMS = (
    "anuria",
    "hydronephrosis",
    "obstructed",
    "obstructing",
    "obstruction",
    "obstructive uropathy",
    "stone",
    "ureteral stone",
    "urolithiasis",
    "수신증",
    "요로결석",
    "요로폐색",
)
OBSTRUCTIVE_PYELONEPHRITIS_CULTURE_ANTIBIOTIC_ACTION_TERMS = (
    "antibiotic",
    "antibiotics",
    "blood culture",
    "cefepime",
    "ceftriaxone",
    "culture",
    "piperacillin",
    "urine culture",
    "항생제",
    "배양",
)
OBSTRUCTIVE_PYELONEPHRITIS_IMAGING_OBSTRUCTION_ACTION_TERMS = (
    "ct",
    "hydronephrosis",
    "obstruction",
    "obstructive",
    "stone",
    "ultrasound",
    "ureteral stone",
    "urolithiasis",
    "수신증",
    "요로결석",
)
OBSTRUCTIVE_PYELONEPHRITIS_DECOMPRESSION_ACTION_TERMS = (
    "decompression",
    "drainage",
    "nephrostomy",
    "pcn",
    "percutaneous nephrostomy",
    "stent",
    "ureteral stent",
    "urology",
    "urgent decompression",
    "배액",
    "스텐트",
)
OBSTRUCTIVE_PYELONEPHRITIS_SEPSIS_SUPPORT_ACTION_TERMS = (
    "fluid",
    "icu",
    "lactate",
    "sepsis",
    "septic shock",
    "shock",
    "vasopressor",
    "쇼크",
    "수액",
)
OBSTRUCTIVE_PYELONEPHRITIS_DELAY_STONE_SAFETY_TERMS = (
    "defer",
    "definitive stone",
    "delay",
    "lithotripsy",
    "postpone",
    "stone removal",
    "until infection",
    "until sepsis",
    "지연",
)
OBSTRUCTIVE_PYELONEPHRITIS_DRAINAGE_OPTION_SAFETY_TERMS = (
    "decompression",
    "drainage",
    "nephrostomy",
    "pcn",
    "percutaneous nephrostomy",
    "retrograde",
    "stent",
    "ureteral stent",
    "배액",
    "스텐트",
)
OBSTRUCTIVE_PYELONEPHRITIS_ANTIBIOTIC_REASSESSMENT_SAFETY_TERMS = (
    "antibiogram",
    "antibiotic adjustment",
    "culture result",
    "renal dosing",
    "reassess",
    "resistance",
    "source control",
    "배양",
)
OBSTRUCTIVE_PYELONEPHRITIS_COMPLICATION_RISK_SAFETY_TERMS = (
    "acute kidney injury",
    "aki",
    "anuria",
    "immunocompromised",
    "pregnancy",
    "renal failure",
    "septic shock",
    "solitary kidney",
    "urosepsis",
    "무뇨",
)
SEVERE_HYPOGLYCEMIA_CONTEXT_TERMS = (
    "blood glucose 40",
    "blood glucose 50",
    "glucose 40",
    "glucose 50",
    "hypoglycemic emergency",
    "hypoglycemic seizure",
    "insulin overdose",
    "insulin shock",
    "low blood glucose",
    "severe hypoglycemia",
    "sulfonylurea overdose",
    "저혈당",
)
SEVERE_HYPOGLYCEMIA_GLUCOSE_CHECK_ACTION_TERMS = (
    "bedside glucose",
    "blood glucose",
    "fingerstick",
    "glucose check",
    "point-of-care glucose",
    "poc glucose",
    "혈당",
)
SEVERE_HYPOGLYCEMIA_DEXTROSE_GLUCAGON_ACTION_TERMS = (
    "carbohydrate",
    "d10",
    "d50",
    "dextrose",
    "glucagon",
    "oral glucose",
    "iv sugar",
    "oral sugar",
    "sugar",
    "포도당",
)
SEVERE_HYPOGLYCEMIA_RECHECK_FEEDING_ACTION_TERMS = (
    "15 minutes",
    "complex carbohydrate",
    "continuous dextrose",
    "dextrose infusion",
    "meal",
    "protein",
    "recheck",
    "repeat glucose",
    "snack",
    "재측정",
)
SEVERE_HYPOGLYCEMIA_ESCALATION_CAUSE_ACTION_TERMS = (
    "admit",
    "altered mental status",
    "cause",
    "hospitalize",
    "long-acting insulin",
    "octreotide",
    "renal failure",
    "seizure",
    "sulfonylurea",
    "입원",
)
SEVERE_HYPOGLYCEMIA_ROUTE_AIRWAY_SAFETY_TERMS = (
    "airway",
    "aspiration",
    "consciousness",
    "npo",
    "seizure",
    "swallow",
    "unconscious",
    "기도",
)
SEVERE_HYPOGLYCEMIA_RECURRENCE_MED_SAFETY_TERMS = (
    "long-acting insulin",
    "octreotide",
    "observation",
    "rebound",
    "recurrent",
    "sulfonylurea",
    "재발",
)
SEVERE_HYPOGLYCEMIA_CAUSE_RISK_SAFETY_TERMS = (
    "adrenal",
    "alcohol",
    "hepatic",
    "kidney",
    "liver",
    "renal",
    "sepsis",
    "간",
    "신장",
)
SEVERE_HYPOGLYCEMIA_DISCHARGE_PREVENTION_SAFETY_TERMS = (
    "cgm",
    "dose adjustment",
    "driving",
    "education",
    "glucagon prescription",
    "meal access",
    "return precautions",
    "safe discharge",
    "교육",
)
MALIGNANT_HYPERTHERMIA_CONTEXT_TERMS = (
    "malignant hyperthermia",
    "mh crisis",
    "malignant hyperthermia crisis",
    "anesthesia hyperthermia",
    "succinylcholine hyperthermia",
    "volatile anesthetic hyperthermia",
    "악성고열",
    "악성 고열",
)
MALIGNANT_HYPERTHERMIA_TRIGGER_STOP_ACTION_TERMS = (
    "discontinue volatile",
    "halt procedure",
    "non-triggering",
    "stop succinylcholine",
    "stop triggering",
    "triggering agent",
    "volatile agent",
    "100% oxygen",
    "산소",
)
MALIGNANT_HYPERTHERMIA_DANTROLENE_ACTION_TERMS = (
    "dantrium",
    "dantrolene",
    "revonto",
    "ryanodex",
    "단트롤렌",
)
MALIGNANT_HYPERTHERMIA_COOLING_ACTION_TERMS = (
    "active cooling",
    "cold saline",
    "cool",
    "cooling",
    "ice",
    "temperature",
    "냉각",
)
MALIGNANT_HYPERTHERMIA_ESCALATION_ACTION_TERMS = (
    "call for help",
    "hotline",
    "icu",
    "intensive care",
    "mh cart",
    "mhaus",
    "urine output",
    "중환자",
)
MALIGNANT_HYPERTHERMIA_METABOLIC_SAFETY_TERMS = (
    "acidosis",
    "arrhythmia",
    "blood gas",
    "calcium",
    "ck",
    "creatine kinase",
    "hyperkalemia",
    "potassium",
    "rhabdomyolysis",
    "횡문근",
    "칼륨",
)
MALIGNANT_HYPERTHERMIA_MONITORING_SAFETY_TERMS = (
    "core temperature",
    "etco2",
    "end-tidal",
    "myoglobin",
    "urine output",
    "vital signs",
    "소변",
)
MALIGNANT_HYPERTHERMIA_DANTROLENE_SAFETY_TERMS = (
    "calcium channel blocker",
    "dantrolene",
    "dose",
    "recrudescence",
    "repeat dose",
    "weakness",
    "단트롤렌",
)
MALIGNANT_HYPERTHERMIA_TRIGGER_PREVENTION_SAFETY_TERMS = (
    "family history",
    "genetic",
    "medical alert",
    "non-triggering anesthesia",
    "ryr1",
    "susceptible",
    "trigger-free",
    "유전",
)
THYROID_STORM_CONTEXT_TERMS = (
    "thyroid crisis",
    "thyroid storm",
    "thyrotoxic crisis",
    "thyrotoxic storm",
    "갑상샘폭풍",
    "갑상선 폭풍",
    "갑상샘 위기",
)
THYROID_STORM_BETA_BLOCKER_ACTION_TERMS = (
    "beta blocker",
    "beta-blocker",
    "esmolol",
    "propranolol",
    "rate control",
    "tachycardia",
    "베타차단",
)
THYROID_STORM_THIONAMIDE_ACTION_TERMS = (
    "antithyroid",
    "methimazole",
    "propylthiouracil",
    "ptu",
    "thionamide",
    "항갑상샘",
    "항갑상선",
)
THYROID_STORM_IODINE_ACTION_TERMS = (
    "iodide",
    "iodine",
    "lugol",
    "potassium iodide",
    "sski",
    "요오드",
)
THYROID_STORM_STEROID_SUPPORT_ACTION_TERMS = (
    "acetaminophen",
    "cooling",
    "dexamethasone",
    "glucocorticoid",
    "hydrocortisone",
    "icu",
    "supportive care",
    "steroid",
    "냉각",
    "스테로이드",
)
THYROID_STORM_SEQUENCE_SAFETY_TERMS = (
    "after thionamide",
    "after methimazole",
    "after ptu",
    "before iodine",
    "iodine after",
    "iodide after",
    "one hour after",
    "thionamide before",
    "요오드 전",
)
THYROID_STORM_BETA_BLOCKER_SAFETY_TERMS = (
    "asthma",
    "bronchospasm",
    "decompensated heart failure",
    "heart failure",
    "hypotension",
    "shock",
    "천식",
    "심부전",
)
THYROID_STORM_DRUG_LIVER_SAFETY_TERMS = (
    "agranulocytosis",
    "cbc",
    "hepatotoxicity",
    "liver",
    "pregnancy",
    "ptu",
    "transaminase",
    "간",
    "임신",
)
THYROID_STORM_TRIGGER_MONITORING_SAFETY_TERMS = (
    "arrhythmia",
    "atrial fibrillation",
    "infection",
    "mi",
    "precipitant",
    "pulmonary embolism",
    "thyroidectomy",
    "trigger",
    "감염",
)
HEAT_STROKE_CONTEXT_TERMS = (
    "classic heat stroke",
    "exertional heat stroke",
    "heat stroke",
    "heatstroke",
    "hyperthermia with altered mental status",
    "열사병",
)
HEAT_STROKE_CORE_TEMP_ACTION_TERMS = (
    "core temperature",
    "rectal temperature",
    "temperature",
    "thermometer",
    "심부체온",
    "직장체온",
)
HEAT_STROKE_RAPID_COOLING_ACTION_TERMS = (
    "cold water immersion",
    "cool first",
    "cooling",
    "evaporative cooling",
    "ice bath",
    "ice water immersion",
    "rapid cooling",
    "whole-body cooling",
    "냉각",
)
HEAT_STROKE_ABC_FLUID_ACTION_TERMS = (
    "airway",
    "circulation",
    "iv fluid",
    "iv fluids",
    "normal saline",
    "oxygen",
    "resuscitation",
    "수액",
)
HEAT_STROKE_ESCALATION_ACTION_TERMS = (
    "critical care",
    "ems",
    "icu",
    "organ failure",
    "transfer",
    "중환자",
)
HEAT_STROKE_OVERCOOLING_SAFETY_TERMS = (
    "38",
    "39",
    "cooling endpoint",
    "core temperature",
    "hypothermia",
    "rectal temperature",
    "stop cooling",
    "target temperature",
    "저체온",
)
HEAT_STROKE_ORGAN_INJURY_SAFETY_TERMS = (
    "aki",
    "ck",
    "coagulation",
    "creatine kinase",
    "dic",
    "electrolyte",
    "liver",
    "renal",
    "rhabdomyolysis",
    "횡문근",
    "신장",
)
HEAT_STROKE_ANTIPYRETIC_SAFETY_TERMS = (
    "acetaminophen",
    "antipyretic",
    "dantrolene",
    "not recommended",
    "nsaid",
    "avoid",
    "해열제",
)
HEAT_STROKE_DIFFERENTIAL_SAFETY_TERMS = (
    "malignant hyperthermia",
    "meningitis",
    "neuroleptic malignant",
    "sepsis",
    "serotonin syndrome",
    "stimulant",
    "감염",
)
CAUDA_EQUINA_CONTEXT_TERMS = (
    "back pain with urinary retention",
    "bladder dysfunction with sciatica",
    "bowel bladder dysfunction",
    "cauda equina",
    "cauda equina compression",
    "cauda equina syndrome",
    "saddle anesthesia",
    "saddle anaesthesia",
    "마미증후군",
    "마미 증후군",
)
CAUDA_EQUINA_MRI_ACTION_TERMS = (
    "emergency mri",
    "immediate mri",
    "lumbar mri",
    "mri",
    "urgent mri",
    "응급 mri",
    "자기공명",
)
CAUDA_EQUINA_BLADDER_ACTION_TERMS = (
    "bladder scan",
    "incontinence",
    "post-void residual",
    "postvoid residual",
    "pvr",
    "urinary retention",
    "voiding",
    "배뇨",
    "요정체",
)
CAUDA_EQUINA_NEURO_EXAM_ACTION_TERMS = (
    "anal tone",
    "lower limb weakness",
    "motor deficit",
    "perianal",
    "perineal",
    "saddle anesthesia",
    "saddle anaesthesia",
    "sensory deficit",
    "항문긴장도",
    "회음부",
)
CAUDA_EQUINA_SPINE_ESCALATION_ACTION_TERMS = (
    "decompression",
    "neurosurgery",
    "operative",
    "spine surgeon",
    "spine surgery",
    "surgical referral",
    "urgent surgery",
    "감압",
    "신경외과",
    "척추",
)
CAUDA_EQUINA_RED_FLAG_SAFETY_TERMS = (
    "bowel",
    "bladder",
    "progressive neurologic",
    "saddle anesthesia",
    "saddle anaesthesia",
    "sexual dysfunction",
    "urinary retention",
    "배변",
    "배뇨",
    "회음부",
)
CAUDA_EQUINA_DELAY_SAFETY_TERMS = (
    "do not delay",
    "emergency pathway",
    "not discharge",
    "not outpatient",
    "not physical therapy",
    "urgent referral",
    "urgent transfer",
    "지연",
    "응급",
)
CAUDA_EQUINA_COMPRESSIVE_CAUSE_SAFETY_TERMS = (
    "cancer",
    "epidural abscess",
    "infection",
    "malignancy",
    "spinal stenosis",
    "trauma",
    "tumor",
    "감염",
    "암",
    "외상",
)
ACUTE_COMPARTMENT_SYNDROME_CONTEXT_TERMS = (
    "acute compartment syndrome",
    "compartment syndrome",
    "구획증후군",
    "급성 구획증후군",
)
ACUTE_COMPARTMENT_SYNDROME_RISK_CONTEXT_TERMS = (
    "burn",
    "cast",
    "crush",
    "fracture",
    "high-energy injury",
    "limb injury",
    "reperfusion",
    "splint",
    "tight dressing",
    "tibial fracture",
    "vascular injury",
    "골절",
    "압궤",
    "화상",
)
ACUTE_COMPARTMENT_SYNDROME_SYMPTOM_CONTEXT_TERMS = (
    "firm compartment",
    "pain on passive stretch",
    "pain out of proportion",
    "passive stretch",
    "severe limb pain",
    "tense compartment",
    "worsening pain",
    "수동 신전",
    "심한 통증",
)
ACUTE_COMPARTMENT_SYNDROME_EXAM_ACTION_TERMS = (
    "capillary refill",
    "neurovascular",
    "pain on passive stretch",
    "pain out of proportion",
    "passive stretch",
    "pulse",
    "serial exam",
    "tense compartment",
    "신경혈관",
    "수동 신전",
)
ACUTE_COMPARTMENT_SYNDROME_PRESSURE_ACTION_TERMS = (
    "compartment pressure",
    "delta pressure",
    "diastolic",
    "intracompartmental pressure",
    "pressure measurement",
    "pressure monitoring",
    "압력",
)
ACUTE_COMPARTMENT_SYNDROME_DECOMPRESSION_ACTION_TERMS = (
    "fasciotomy",
    "orthopedic",
    "orthopaedic",
    "surgical decompression",
    "surgical emergency",
    "surgery",
    "urgent decompression",
    "정형외과",
    "근막절개",
)
ACUTE_COMPARTMENT_SYNDROME_TEMPORIZE_ACTION_TERMS = (
    "blood pressure",
    "bivalve",
    "cast removal",
    "dressing release",
    "heart level",
    "hypotension",
    "remove cast",
    "remove dressing",
    "splint removal",
    "압박 해제",
    "혈압",
)
ACUTE_COMPARTMENT_SYNDROME_DELAY_SAFETY_TERMS = (
    "do not delay",
    "emergent",
    "immediate",
    "within 1 hour",
    "urgent",
    "지연",
    "응급",
)
ACUTE_COMPARTMENT_SYNDROME_MASKING_SAFETY_TERMS = (
    "analgesia",
    "consciousness",
    "regional anesthesia",
    "sedation",
    "serial reassessment",
    "unable to assess",
    "무통",
    "진정",
)
ACUTE_COMPARTMENT_SYNDROME_COMPLICATION_SAFETY_TERMS = (
    "acute kidney injury",
    "aki",
    "hyperkalemia",
    "ischemia",
    "limb loss",
    "muscle necrosis",
    "nerve injury",
    "renal failure",
    "rhabdomyolysis",
    "괴사",
    "신부전",
)
ACUTE_COMPARTMENT_SYNDROME_CAUSE_SAFETY_TERMS = (
    "burn",
    "cast",
    "crush",
    "fracture",
    "reperfusion",
    "tight dressing",
    "vascular injury",
    "골절",
    "압궤",
    "화상",
)
ACUTE_LIMB_ISCHEMIA_CONTEXT_TERMS = (
    "6 ps",
    "acute arterial occlusion",
    "acute limb ischemia",
    "acute limb ischaemia",
    "cold pulseless limb",
    "limb ischemia",
    "limb ischaemia",
    "pain pallor pulselessness",
    "pulseless cold limb",
    "six ps",
    "threatened limb",
    "급성 사지 허혈",
    "사지 허혈",
)
ACUTE_LIMB_ISCHEMIA_VIABILITY_ACTION_TERMS = (
    "6 ps",
    "capillary refill",
    "doppler",
    "limb viability",
    "motor deficit",
    "pulse",
    "rutherford",
    "sensory deficit",
    "six ps",
    "도플러",
    "맥박",
)
ACUTE_LIMB_ISCHEMIA_HEPARIN_ACTION_TERMS = (
    "anticoagulation",
    "heparin",
    "heparin infusion",
    "iv heparin",
    "unfractionated heparin",
    "항응고",
    "헤파린",
)
ACUTE_LIMB_ISCHEMIA_REVASCULARIZATION_ACTION_TERMS = (
    "bypass",
    "catheter-directed thrombolysis",
    "embolectomy",
    "endovascular",
    "revascularization",
    "revascularisation",
    "surgical",
    "thrombectomy",
    "vascular surgery",
    "vascular surgeon",
    "혈관외과",
    "재관류",
)
ACUTE_LIMB_ISCHEMIA_BLEEDING_SAFETY_TERMS = (
    "active bleeding",
    "anticoagulation",
    "bleeding",
    "contraindication",
    "heparin",
    "intracranial hemorrhage",
    "platelet",
    "recent surgery",
    "thrombolysis",
    "출혈",
    "혈소판",
)
ACUTE_LIMB_ISCHEMIA_IRREVERSIBLE_COMPARTMENT_SAFETY_TERMS = (
    "compartment syndrome",
    "fasciotomy",
    "irreversible",
    "muscle necrosis",
    "nonviable",
    "paralysis",
    "reperfusion injury",
    "rutherford iii",
    "구획증후군",
)
ACUTE_LIMB_ISCHEMIA_SOURCE_DIFFERENTIAL_SAFETY_TERMS = (
    "aneurysm",
    "atrial fibrillation",
    "cardiac embol",
    "embol",
    "popliteal aneurysm",
    "thrombosis",
    "trauma",
    "vascular access",
    "심방세동",
    "색전",
    "혈전",
)
TESTICULAR_TORSION_CONTEXT_TERMS = (
    "acute scrotal pain",
    "acute testicular pain",
    "high-riding testis",
    "painful testicle",
    "scrotal pain",
    "testicular torsion",
    "torsion of the testis",
    "twisted spermatic cord",
    "고환염전",
    "고환 염전",
    "급성 음낭통",
)
TESTICULAR_TORSION_ASSESSMENT_ACTION_TERMS = (
    "absent cremasteric",
    "cremasteric reflex",
    "doppler",
    "high clinical suspicion",
    "high-riding",
    "horizontal lie",
    "nausea",
    "scrotal ultrasound",
    "ultrasound",
    "초음파",
)
TESTICULAR_TORSION_UROLOGY_SURGERY_ACTION_TERMS = (
    "orchiopexy",
    "scrotal exploration",
    "surgical exploration",
    "urology",
    "urgent exploration",
    "urgent surgery",
    "uro consult",
    "비뇨",
    "수술",
)
TESTICULAR_TORSION_DELAY_ACTION_TERMS = (
    "do not delay",
    "immediate",
    "not delay",
    "not postpone",
    "time critical",
    "urgent",
    "지연",
    "즉시",
)
TESTICULAR_TORSION_SALVAGE_SAFETY_TERMS = (
    "4 hour",
    "6 hour",
    "8 hour",
    "ischemia",
    "orchiectomy",
    "salvage",
    "time from onset",
    "viability",
    "허혈",
)
TESTICULAR_TORSION_MANUAL_DETORSION_SAFETY_TERMS = (
    "manual detorsion",
    "not definitive",
    "not delay",
    "orchiopexy",
    "surgery still required",
    "untwist",
    "수기 정복",
)
TESTICULAR_TORSION_BILATERAL_FIXATION_SAFETY_TERMS = (
    "bilateral",
    "contralateral",
    "fertility",
    "orchiectomy",
    "orchiopexy",
    "testicular loss",
    "불임",
)
TESTICULAR_TORSION_DIFFERENTIAL_SAFETY_TERMS = (
    "appendage torsion",
    "epididymitis",
    "hernia",
    "hydrocele",
    "orchitis",
    "trauma",
    "varicocele",
    "감별",
)
OVARIAN_TORSION_CONTEXT_TERMS = (
    "adnexal torsion",
    "acute pelvic pain with adnexal mass",
    "intermittent unilateral pelvic pain",
    "ovarian torsion",
    "torsion of the ovary",
    "torsed ovary",
    "난소염전",
    "난소 염전",
)
OVARIAN_TORSION_PREGNANCY_ACTION_TERMS = (
    "beta hcg",
    "beta-hcg",
    "hcg",
    "pregnancy test",
    "quantitative hcg",
    "β-hcg",
    "임신",
)
OVARIAN_TORSION_ULTRASOUND_ACTION_TERMS = (
    "doppler",
    "pelvic ultrasound",
    "transvaginal ultrasound",
    "tvu",
    "tvus",
    "ultrasound",
    "초음파",
)
OVARIAN_TORSION_SURGICAL_ACTION_TERMS = (
    "diagnostic laparoscopy",
    "detorsion",
    "gynecology",
    "laparoscopy",
    "ob/gyn",
    "obgyn",
    "surgical evaluation",
    "urgent surgery",
    "산부인과",
    "수술",
)
OVARIAN_TORSION_DOPPLER_DELAY_SAFETY_TERMS = (
    "do not delay",
    "doppler flow",
    "normal doppler",
    "not delay",
    "not rule out",
    "timely intervention",
    "지연",
)
OVARIAN_TORSION_PRESERVATION_SAFETY_TERMS = (
    "cystectomy",
    "detorsion",
    "fertility",
    "oophorectomy",
    "ovarian function",
    "ovarian preservation",
    "preserve",
    "난소 보존",
)
OVARIAN_TORSION_DIFFERENTIAL_SAFETY_TERMS = (
    "appendicitis",
    "ectopic",
    "hemorrhagic cyst",
    "ovarian cyst",
    "pid",
    "pregnancy",
    "ruptured cyst",
    "tubo-ovarian abscess",
    "감별",
)
SPINAL_EPIDURAL_ABSCESS_CONTEXT_TERMS = (
    "discitis with epidural abscess",
    "epidural abscess",
    "infectious cord compression",
    "spinal abscess",
    "spinal epidural abscess",
    "spinal infection with neurologic deficit",
    "vertebral osteomyelitis with epidural extension",
    "척추 경막외 농양",
)
SPINAL_EPIDURAL_ABSCESS_MRI_ACTION_TERMS = (
    "contrast mri",
    "emergency mri",
    "immediate mri",
    "mri",
    "mri spine",
    "spine mri",
    "whole spine",
    "응급 mri",
)
SPINAL_EPIDURAL_ABSCESS_CULTURE_LAB_ACTION_TERMS = (
    "blood culture",
    "blood cultures",
    "crp",
    "culture",
    "cultures",
    "esr",
    "source culture",
    "배양",
    "혈액배양",
)
SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_ACTION_TERMS = (
    "antibiotic",
    "antibiotics",
    "cefepime",
    "ceftriaxone",
    "empiric",
    "meropenem",
    "vancomycin",
    "항생제",
)
SPINAL_EPIDURAL_ABSCESS_SURGERY_ACTION_TERMS = (
    "decompression",
    "drainage",
    "neurosurgery",
    "source control",
    "spine surgery",
    "surgical consultation",
    "surgical decompression",
    "감압",
    "신경외과",
)
SPINAL_EPIDURAL_ABSCESS_NEURO_SEPSIS_SAFETY_TERMS = (
    "bowel",
    "bladder",
    "neurologic",
    "paralysis",
    "sepsis",
    "serial exam",
    "weakness",
    "신경",
    "패혈증",
)
SPINAL_EPIDURAL_ABSCESS_RISK_SOURCE_SAFETY_TERMS = (
    "bacteremia",
    "diabetes",
    "endocarditis",
    "immunosuppression",
    "iv drug",
    "ivdu",
    "recent spinal procedure",
    "source",
    "staphylococcus",
    "감염원",
)
SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_TIMING_SAFETY_TERMS = (
    "after blood cultures",
    "biopsy",
    "blood culture",
    "culture before",
    "do not delay",
    "empiric antibiotics",
    "neurologic compromise",
    "unstable",
    "배양",
)
SEPTIC_ARTHRITIS_CONTEXT_TERMS = (
    "acute septic arthritis",
    "bacterial arthritis",
    "hot swollen joint",
    "native joint septic arthritis",
    "septic arthritis",
    "septic joint",
    "septic monoarthritis",
    "화농성 관절염",
)
SEPTIC_ARTHRITIS_ARTHROCENTESIS_ACTION_TERMS = (
    "arthrocentesis",
    "aspiration",
    "joint aspiration",
    "synovial aspiration",
    "synovial fluid",
    "tap",
    "관절천자",
)
SEPTIC_ARTHRITIS_SYNOVIAL_STUDY_ACTION_TERMS = (
    "cell count",
    "crystal",
    "culture",
    "gram stain",
    "leukocyte",
    "microscopy",
    "synovial",
    "wbc",
    "배양",
)
SEPTIC_ARTHRITIS_BLOOD_CULTURE_LAB_ACTION_TERMS = (
    "blood culture",
    "blood cultures",
    "crp",
    "esr",
    "inflammatory marker",
    "leukocytosis",
    "배양",
    "혈액배양",
)
SEPTIC_ARTHRITIS_ANTIBIOTIC_ACTION_TERMS = (
    "antibiotic",
    "antibiotics",
    "ceftriaxone",
    "empiric",
    "vancomycin",
    "항생제",
)
SEPTIC_ARTHRITIS_DRAINAGE_ORTHO_ACTION_TERMS = (
    "arthroscopy",
    "drainage",
    "irrigation",
    "orthopedic",
    "orthopedics",
    "surgical washout",
    "washout",
    "정형외과",
)
SEPTIC_ARTHRITIS_CRYSTAL_LIMITATION_SAFETY_TERMS = (
    "crystal",
    "crystals do not exclude",
    "gout",
    "not exclude",
    "pseudogout",
    "still possible",
    "통풍",
)
SEPTIC_ARTHRITIS_ANTIBIOTIC_TIMING_SAFETY_TERMS = (
    "after aspiration",
    "after blood cultures",
    "before antibiotics",
    "culture before",
    "do not delay",
    "empiric antibiotics",
    "sepsis",
    "unstable",
    "배양",
)
SEPTIC_ARTHRITIS_PATHOGEN_RISK_SAFETY_TERMS = (
    "gonococcal",
    "gram-negative",
    "immunocompromised",
    "ivdu",
    "mrsa",
    "staphylococcus",
    "vancomycin",
    "임질",
)
SEPTIC_ARTHRITIS_COMPLICATION_SOURCE_SAFETY_TERMS = (
    "bacteremia",
    "endocarditis",
    "osteomyelitis",
    "prosthetic joint",
    "sepsis",
    "source",
    "surgery",
    "패혈증",
)
UPPER_GI_BLEED_CONTEXT_TERMS = (
    "coffee ground emesis",
    "esophageal variceal bleeding",
    "hematemesis",
    "melena",
    "nonvariceal upper gi bleeding",
    "peptic ulcer bleeding",
    "upper gastrointestinal bleeding",
    "upper gi bleed",
    "upper gi bleeding",
    "variceal bleeding",
    "토혈",
    "흑색변",
)
UPPER_GI_BLEED_RESUSCITATION_ACTION_TERMS = (
    "blood pressure",
    "hemodynamic",
    "iv access",
    "large-bore",
    "massive transfusion",
    "resuscitation",
    "shock",
    "two large bore",
    "수액",
    "쇼크",
)
UPPER_GI_BLEED_TRANSFUSION_LAB_ACTION_TERMS = (
    "cbc",
    "crossmatch",
    "hemoglobin",
    "inr",
    "packed red blood",
    "prbc",
    "restrictive transfusion",
    "transfusion",
    "type and screen",
    "수혈",
)
UPPER_GI_BLEED_ENDOSCOPY_ACTION_TERMS = (
    "early endoscopy",
    "endoscopic hemostasis",
    "endoscopy",
    "egd",
    "gastroenterology",
    "gi consult",
    "within 24 hours",
    "내시경",
)
UPPER_GI_BLEED_PPI_VARICEAL_ACTION_TERMS = (
    "antibiotic",
    "ceftriaxone",
    "octreotide",
    "ppi",
    "proton pump",
    "somatostatin",
    "terlipressin",
    "vasoactive",
    "항생제",
)
UPPER_GI_BLEED_AIRWAY_ASPIRATION_SAFETY_TERMS = (
    "airway",
    "altered mental status",
    "aspiration",
    "active hematemesis",
    "intubation",
    "vomiting blood",
    "기도",
)
UPPER_GI_BLEED_ANTITHROMBOTIC_REVERSAL_SAFETY_TERMS = (
    "anticoagulant",
    "antiplatelet",
    "coagulopathy",
    "doac",
    "inr",
    "platelet",
    "reversal",
    "warfarin",
    "항응고",
)
UPPER_GI_BLEED_VARICEAL_RESCUE_SAFETY_TERMS = (
    "balloon tamponade",
    "cirrhosis",
    "portal hypertension",
    "rescue",
    "stent",
    "tips",
    "variceal",
    "정맥류",
)
UPPER_GI_BLEED_REBLEED_DISPOSITION_SAFETY_TERMS = (
    "icu",
    "rebleeding",
    "repeat endoscopy",
    "risk stratification",
    "shock",
    "unstable",
    "혈역학",
)
ACUTE_CHOLECYSTITIS_CONTEXT_TERMS = (
    "acalculous cholecystitis",
    "acute cholecystitis",
    "emphysematous cholecystitis",
    "gangrenous cholecystitis",
    "perforated cholecystitis",
    "suppurative cholecystitis",
    "급성 담낭염",
)
ACUTE_CHOLECYSTITIS_SEVERITY_ACTION_TERMS = (
    "asa",
    "cci",
    "charlson",
    "grade",
    "organ dysfunction",
    "severity",
    "tokyo",
    "중증도",
)
ACUTE_CHOLECYSTITIS_ANTIBIOTIC_CULTURE_ACTION_TERMS = (
    "antibiotic",
    "bile culture",
    "blood culture",
    "broad-spectrum",
    "ceftriaxone",
    "culture",
    "piperacillin",
    "항생제",
)
ACUTE_CHOLECYSTITIS_IMAGING_ACTION_TERMS = (
    "ct",
    "gallbladder wall",
    "hidascan",
    "murphy",
    "pericholecystic",
    "ruq ultrasound",
    "sonographic",
    "ultrasound",
    "초음파",
)
ACUTE_CHOLECYSTITIS_SOURCE_CONTROL_ACTION_TERMS = (
    "cholecystectomy",
    "cholecystostomy",
    "drainage",
    "gallbladder drainage",
    "laparoscopic",
    "lap-c",
    "percutaneous",
    "ptgbd",
    "담낭절제",
)
ACUTE_CHOLECYSTITIS_HIGH_RISK_DRAINAGE_SAFETY_TERMS = (
    "asa-ps",
    "charlson",
    "cholecystostomy",
    "drainage",
    "gallbladder drainage",
    "high risk",
    "percutaneous",
    "ptgbd",
)
ACUTE_CHOLECYSTITIS_COMPLICATION_SAFETY_TERMS = (
    "emphysematous",
    "gangrenous",
    "perforation",
    "peritonitis",
    "sepsis",
    "shock",
    "심한",
)
ACUTE_CHOLECYSTITIS_BILE_DUCT_SAFETY_TERMS = (
    "bile duct injury",
    "bile leak",
    "bail-out",
    "common bile duct",
    "critical view",
    "subtotal cholecystectomy",
    "conversion",
    "cvs",
)
ACUTE_CHOLECYSTITIS_DIFFERENTIAL_SAFETY_TERMS = (
    "cholangitis",
    "choledocholithiasis",
    "gallstone pancreatitis",
    "hepatitis",
    "myocardial infarction",
    "pancreatitis",
    "peptic ulcer",
    "감별",
)
ACUTE_CHOLANGITIS_CONTEXT_TERMS = (
    "acute cholangitis",
    "ascending cholangitis",
    "biliary sepsis",
    "choledocholithiasis with cholangitis",
    "infected biliary obstruction",
    "obstructive cholangitis",
    "suppurative cholangitis",
    "담관염",
)
ACUTE_CHOLANGITIS_ANTIBIOTIC_SUPPORT_ACTION_TERMS = (
    "antibiotic",
    "antibiotics",
    "broad-spectrum",
    "cefepime",
    "ceftriaxone",
    "piperacillin",
    "supportive care",
    "tazobactam",
    "항생제",
)
ACUTE_CHOLANGITIS_CULTURE_LAB_ACTION_TERMS = (
    "bilirubin",
    "blood culture",
    "blood cultures",
    "bile culture",
    "crp",
    "inflammatory",
    "lft",
    "liver function",
    "wbc",
    "배양",
    "빌리루빈",
)
ACUTE_CHOLANGITIS_IMAGING_OBSTRUCTION_ACTION_TERMS = (
    "biliary dilatation",
    "biliary dilation",
    "common bile duct",
    "ct",
    "mrcp",
    "obstruction",
    "stone",
    "stricture",
    "ultrasound",
    "초음파",
)
ACUTE_CHOLANGITIS_DRAINAGE_ACTION_TERMS = (
    "biliary decompression",
    "biliary drainage",
    "drainage",
    "ercp",
    "nasobiliary",
    "ptbd",
    "stent",
    "percutaneous transhepatic",
    "담도 배액",
)
ACUTE_CHOLANGITIS_ORGAN_SUPPORT_ACTION_TERMS = (
    "circulatory",
    "fluid",
    "icu",
    "organ support",
    "respiratory",
    "sepsis",
    "shock",
    "vasopressor",
    "중환자",
    "쇼크",
)
ACUTE_CHOLANGITIS_SEVERITY_SAFETY_TERMS = (
    "acute dyspnea",
    "dic",
    "disturbance of consciousness",
    "organ dysfunction",
    "renal dysfunction",
    "severity",
    "shock",
    "tokyo",
    "의식",
    "장기부전",
)
ACUTE_CHOLANGITIS_DRAINAGE_TIMING_SAFETY_TERMS = (
    "48 hours",
    "advanced center",
    "do not delay",
    "early drainage",
    "emergency biliary drainage",
    "transfer",
    "within 24",
    "within 48",
    "지연",
)
ACUTE_CHOLANGITIS_PROCEDURE_RISK_SAFETY_TERMS = (
    "altered anatomy",
    "anticoagulant",
    "coagulopathy",
    "failed ercp",
    "pancreatitis",
    "percutaneous drainage",
    "ptbd",
    "sphincterotomy",
    "항응고",
)
ACUTE_CHOLANGITIS_DIFFERENTIAL_SOURCE_SAFETY_TERMS = (
    "acute cholecystitis",
    "bile culture",
    "cholecystitis",
    "gallstone pancreatitis",
    "malignant obstruction",
    "pancreatitis",
    "source control",
    "stone",
    "감별",
)
ACUTE_PANCREATITIS_CONTEXT_TERMS = (
    "acute pancreatitis",
    "biliary pancreatitis",
    "gallstone pancreatitis",
    "necrotizing pancreatitis",
    "pancreatic necrosis",
    "severe pancreatitis",
    "췌장염",
)
ACUTE_PANCREATITIS_FLUID_ACTION_TERMS = (
    "crystalloid",
    "fluid",
    "fluids",
    "goal-directed",
    "lactated ringer",
    "lr",
    "resuscitation",
    "수액",
)
ACUTE_PANCREATITIS_ANALGESIA_SUPPORT_ACTION_TERMS = (
    "analgesia",
    "antiemetic",
    "nausea",
    "opioid",
    "pain control",
    "통증",
)
ACUTE_PANCREATITIS_DIAGNOSTIC_ETIOLOGY_ACTION_TERMS = (
    "alt",
    "calcium",
    "gallstone",
    "lft",
    "lipase",
    "triglyceride",
    "ultrasound",
    "췌장효소",
)
ACUTE_PANCREATITIS_SEVERITY_ORGAN_ACTION_TERMS = (
    "bun",
    "hematocrit",
    "icu",
    "organ failure",
    "oxygen",
    "renal",
    "severity",
    "shock",
    "장기부전",
)
ACUTE_PANCREATITIS_ERCP_CHOLANGITIS_SAFETY_TERMS = (
    "biliary obstruction",
    "cholangitis",
    "ercp",
    "jaundice",
    "no cholangitis",
    "without cholangitis",
    "담관염",
)
ACUTE_PANCREATITIS_ANTIBIOTIC_SAFETY_TERMS = (
    "antibiotic",
    "extrapancreatic infection",
    "infected necrosis",
    "prophylactic antibiotics",
    "sterile necrosis",
    "항생제",
)
ACUTE_PANCREATITIS_NUTRITION_SAFETY_TERMS = (
    "enteral",
    "feeding",
    "ng tube",
    "oral feeding",
    "parenteral",
    "tpn",
    "영양",
)
ACUTE_PANCREATITIS_NECROSIS_PROCEDURE_SAFETY_TERMS = (
    "4 weeks",
    "drainage",
    "infected necrosis",
    "necrosis",
    "step-up",
    "walled-off",
    "췌장괴사",
)
SMALL_BOWEL_OBSTRUCTION_CONTEXT_TERMS = (
    "adhesive small bowel obstruction",
    "bowel obstruction with vomiting",
    "closed-loop bowel obstruction",
    "closed-loop obstruction",
    "high-grade small bowel obstruction",
    "sbo",
    "small bowel obstruction",
    "strangulating obstruction",
    "장폐색",
)
SMALL_BOWEL_OBSTRUCTION_NPO_NG_ACTION_TERMS = (
    "bowel rest",
    "decompression",
    "ng tube",
    "nil per os",
    "npo",
    "nasogastric",
    "suction",
    "금식",
)
SMALL_BOWEL_OBSTRUCTION_FLUID_ELECTROLYTE_ACTION_TERMS = (
    "crystalloid",
    "dehydration",
    "electrolyte",
    "fluid",
    "fluids",
    "potassium",
    "urine output",
    "수액",
    "전해질",
)
SMALL_BOWEL_OBSTRUCTION_CT_TRANSITION_ACTION_TERMS = (
    "closed-loop",
    "ct",
    "ct abdomen",
    "free fluid",
    "ischemia",
    "strangulation",
    "transition point",
    "복부 ct",
)
SMALL_BOWEL_OBSTRUCTION_SURGERY_ACTION_TERMS = (
    "exploration",
    "laparotomy",
    "operative",
    "surgery",
    "surgical consult",
    "surgeon",
    "외과",
)
SMALL_BOWEL_OBSTRUCTION_STRANGULATION_SAFETY_TERMS = (
    "acidosis",
    "closed-loop",
    "continuous pain",
    "fever",
    "ischemia",
    "lactate",
    "leukocytosis",
    "peritonitis",
    "strangulation",
    "복막염",
)
SMALL_BOWEL_OBSTRUCTION_NONOPERATIVE_LIMITS_SAFETY_TERMS = (
    "72 hours",
    "complete obstruction",
    "conservative",
    "failure to resolve",
    "gastrografin",
    "nonoperative",
    "serial exam",
    "water-soluble contrast",
    "관찰",
)
SMALL_BOWEL_OBSTRUCTION_PERFORATION_SEPSIS_SAFETY_TERMS = (
    "antibiotic",
    "broad-spectrum",
    "free air",
    "gangrene",
    "infarction",
    "perforation",
    "sepsis",
    "항생제",
)
SMALL_BOWEL_OBSTRUCTION_ASPIRATION_ETIOLOGY_SAFETY_TERMS = (
    "adhesion",
    "aspiration",
    "hernia",
    "incarcerated hernia",
    "malignancy",
    "tumor",
    "volvulus",
    "vomiting",
    "흡인",
)
ACUTE_APPENDICITIS_CONTEXT_TERMS = (
    "acute appendicitis",
    "appendiceal abscess",
    "appendicitis",
    "perforated appendicitis",
    "right lower quadrant pain with anorexia",
    "rlq pain migrating",
    "충수염",
)
ACUTE_APPENDICITIS_RISK_IMAGING_ACTION_TERMS = (
    "aas",
    "adult appendicitis score",
    "air score",
    "alvarado",
    "clinical score",
    "ct",
    "imaging",
    "mri",
    "risk score",
    "ultrasound",
    "초음파",
)
ACUTE_APPENDICITIS_SURGERY_ACTION_TERMS = (
    "appendectomy",
    "appendicectomy",
    "laparoscopic",
    "laparoscopy",
    "operation",
    "surgeon",
    "surgery",
    "surgical consult",
    "수술",
    "외과",
)
ACUTE_APPENDICITIS_ANTIBIOTIC_ACTION_TERMS = (
    "antibiotic",
    "broad-spectrum",
    "ceftriaxone",
    "cefoxitin",
    "metronidazole",
    "perioperative",
    "piperacillin",
    "preoperative",
    "항생제",
)
ACUTE_APPENDICITIS_COMPLICATION_ACTION_TERMS = (
    "abscess",
    "complicated",
    "drainage",
    "perforation",
    "peritonitis",
    "phlegmon",
    "sepsis",
    "source control",
    "복막염",
)
ACUTE_APPENDICITIS_NONOPERATIVE_SELECTION_SAFETY_TERMS = (
    "antibiotics-first",
    "appendicolith",
    "recurrence",
    "selected",
    "shared decision",
    "uncomplicated",
    "nonoperative",
    "비수술",
)
ACUTE_APPENDICITIS_SOURCE_CONTROL_SAFETY_TERMS = (
    "2-3 days",
    "abscess drainage",
    "complicated",
    "drainage",
    "percutaneous",
    "postoperative antibiotic",
    "short course",
    "source control",
)
ACUTE_APPENDICITIS_SPECIAL_POPULATION_DIFFERENTIAL_SAFETY_TERMS = (
    "ectopic",
    "gynecologic",
    "immunocompromised",
    "older",
    "pediatric",
    "pregnancy",
    "renal colic",
    "terminal ileitis",
    "임신",
)
ACUTE_APPENDICITIS_PERITONITIS_SEPSIS_SAFETY_TERMS = (
    "diffuse peritonitis",
    "generalized peritonitis",
    "perforation",
    "peritonitis",
    "rupture",
    "sepsis",
    "shock",
    "복막염",
)
ACUTE_MESENTERIC_ISCHEMIA_CONTEXT_TERMS = (
    "acute bowel ischemia",
    "acute intestinal ischemia",
    "acute mesenteric ischemia",
    "bowel infarction",
    "bowel ischemia",
    "intestinal ischemia",
    "mesenteric ischemia",
    "pain out of proportion",
    "sma embolus",
    "sma thrombosis",
    "장간막 허혈",
)
ACUTE_MESENTERIC_ISCHEMIA_CTA_ACTION_TERMS = (
    "cta",
    "ct angiography",
    "ct mesenteric angiography",
    "mesenteric angiography",
    "multidetector ct",
    "복부 ct",
)
ACUTE_MESENTERIC_ISCHEMIA_RESUSCITATION_ACTION_TERMS = (
    "fluid",
    "fluids",
    "lactate",
    "metabolic acidosis",
    "resuscitation",
    "shock",
    "수액",
    "젖산",
)
ACUTE_MESENTERIC_ISCHEMIA_ANTIBIOTIC_ACTION_TERMS = (
    "antibiotic",
    "antibiotics",
    "broad-spectrum",
    "empiric",
    "piperacillin",
    "tazobactam",
    "항생제",
)
ACUTE_MESENTERIC_ISCHEMIA_SURGERY_REVASCULARIZATION_ACTION_TERMS = (
    "embolectomy",
    "endovascular",
    "exploratory laparotomy",
    "laparotomy",
    "resection",
    "revascularization",
    "revascularisation",
    "sma",
    "vascular surgery",
    "혈관외과",
    "재관류",
)
ACUTE_MESENTERIC_ISCHEMIA_ANTICOAGULATION_SAFETY_TERMS = (
    "anticoagulation",
    "bleeding",
    "heparin",
    "intracranial hemorrhage",
    "platelet",
    "recent surgery",
    "출혈",
    "헤파린",
)
ACUTE_MESENTERIC_ISCHEMIA_BOWEL_VIABILITY_SAFETY_TERMS = (
    "bowel viability",
    "damage control",
    "necrotic bowel",
    "peritonitis",
    "re-look",
    "second look",
    "short bowel",
    "viability",
    "복막염",
)
ACUTE_MESENTERIC_ISCHEMIA_CAUSE_TYPE_SAFETY_TERMS = (
    "atrial fibrillation",
    "embol",
    "low-flow",
    "nomas",
    "nonocclusive",
    "sma",
    "thrombosis",
    "venous thrombosis",
    "심방세동",
    "혈전",
)
ACUTE_MESENTERIC_ISCHEMIA_LACTATE_LIMITATION_SAFETY_TERMS = (
    "do not delay",
    "lactate",
    "normal lactate",
    "not exclude",
    "not rule out",
    "pain out of proportion",
    "젖산",
)
NECROTIZING_SOFT_TISSUE_INFECTION_CONTEXT_TERMS = (
    "fournier gangrene",
    "fournier's gangrene",
    "gas gangrene",
    "nec fasc",
    "necrotising fasciitis",
    "necrotizing fasciitis",
    "necrotizing soft tissue infection",
    "necrotizing soft-tissue infection",
    "nsti",
    "괴사성 근막염",
)
NECROTIZING_SOFT_TISSUE_INFECTION_SURGERY_ACTION_TERMS = (
    "debridement",
    "exploration",
    "fasciotomy",
    "operative",
    "surgical consult",
    "surgical debridement",
    "surgical exploration",
    "surgery",
    "수술",
)
NECROTIZING_SOFT_TISSUE_INFECTION_ANTIBIOTIC_ACTION_TERMS = (
    "antibiotic",
    "antibiotics",
    "broad-spectrum",
    "carbapenem",
    "clindamycin",
    "linezolid",
    "piperacillin",
    "tazobactam",
    "vancomycin",
    "항생제",
)
NECROTIZING_SOFT_TISSUE_INFECTION_RESUSCITATION_ACTION_TERMS = (
    "fluid",
    "fluids",
    "icu",
    "lactate",
    "resuscitation",
    "sepsis",
    "shock",
    "vasopressor",
    "수액",
    "패혈증",
)
NECROTIZING_SOFT_TISSUE_INFECTION_DELAY_ACTION_TERMS = (
    "do not delay",
    "immediate",
    "not delay",
    "source control",
    "time critical",
    "urgent",
    "지연",
    "즉시",
)
NECROTIZING_SOFT_TISSUE_INFECTION_TOXIN_SAFETY_TERMS = (
    "clindamycin",
    "gas gangrene",
    "group a strep",
    "linezolid",
    "strep",
    "streptococcal",
    "toxin",
    "독소",
)
NECROTIZING_SOFT_TISSUE_INFECTION_REPEAT_SOURCE_SAFETY_TERMS = (
    "24",
    "48",
    "debridement",
    "repeat",
    "re-look",
    "second look",
    "source control",
    "재수술",
)
NECROTIZING_SOFT_TISSUE_INFECTION_DIAGNOSTIC_LIMITATION_SAFETY_TERMS = (
    "ct should not delay",
    "do not delay",
    "imaging",
    "lrinec",
    "not exclude",
    "not rule out",
    "surgical exploration",
    "지연",
)
NECROTIZING_SOFT_TISSUE_INFECTION_ORGAN_RISK_SAFETY_TERMS = (
    "aki",
    "amputation",
    "coagulopathy",
    "diabetes",
    "immunocompromised",
    "organ failure",
    "renal",
    "shock",
    "괴사",
    "절단",
)
RUPTURED_AAA_CONTEXT_TERMS = (
    "abdominal aortic aneurysm rupture",
    "pulsatile abdominal mass",
    "ruptured abdominal aortic aneurysm",
    "ruptured aaa",
    "symptomatic abdominal aortic aneurysm",
    "symptomatic aaa",
    "대동맥류 파열",
    "복부 대동맥류",
)
RUPTURED_AAA_VASCULAR_ACTION_TERMS = (
    "aneurysm repair",
    "evar",
    "open repair",
    "operative repair",
    "vascular surgery",
    "vascular surgeon",
    "혈관외과",
    "수술",
)
RUPTURED_AAA_HEMODYNAMIC_ACTION_TERMS = (
    "controlled resuscitation",
    "hypotensive resuscitation",
    "permissive hypotension",
    "restrictive fluid",
    "systolic",
    "target blood pressure",
    "저혈압",
)
RUPTURED_AAA_BLOOD_ACTION_TERMS = (
    "blood product",
    "crossmatch",
    "large-bore",
    "massive transfusion",
    "packed rbc",
    "prbc",
    "type and cross",
    "type and screen",
    "수혈",
)
RUPTURED_AAA_IMAGING_ACTION_TERMS = (
    "bedside ultrasound",
    "ct angiography",
    "cta",
    "not delay",
    "unstable",
    "ultrasound",
    "초음파",
)
RUPTURED_AAA_TRANSFER_DELAY_SAFETY_TERMS = (
    "do not delay",
    "door-to-intervention",
    "immediate repair",
    "not delay",
    "transfer",
    "unstable",
    "urgent vascular",
    "전원",
    "지연",
)
RUPTURED_AAA_ANTITHROMBOTIC_SAFETY_TERMS = (
    "anticoagulation",
    "antiplatelet",
    "bleeding",
    "hemorrhage",
    "thrombolysis",
    "출혈",
    "항응고",
)
RUPTURED_AAA_SHOCK_COMPLICATION_SAFETY_TERMS = (
    "abdominal compartment",
    "cardiac arrest",
    "coagulopathy",
    "hypothermia",
    "renal",
    "shock",
    "triad",
    "응고",
    "쇼크",
)
SUBARACHNOID_HEMORRHAGE_CONTEXT_TERMS = (
    "aneurysmal sah",
    "sentinel headache",
    "subarachnoid haemorrhage",
    "subarachnoid hemorrhage",
    "sudden worst headache",
    "thunderclap headache",
    "worst headache of life",
    "지주막하 출혈",
    "지주막하출혈",
)
SUBARACHNOID_HEMORRHAGE_CT_ACTION_TERMS = (
    "ct head",
    "head ct",
    "non contrast ct",
    "non-contrast ct",
    "noncontrast ct",
    "뇌 ct",
    "두부 ct",
)
SUBARACHNOID_HEMORRHAGE_LP_CTA_ACTION_TERMS = (
    "ct angiography",
    "cta",
    "lumbar puncture",
    "lp",
    "xanthochromia",
    "요추천자",
    "혈관조영",
)
SUBARACHNOID_HEMORRHAGE_NEURO_ACTION_TERMS = (
    "neurocritical",
    "neurosurgery",
    "neurosurgical",
    "transfer",
    "중환자",
    "신경외과",
    "전원",
)
SUBARACHNOID_HEMORRHAGE_BP_NIMODIPINE_ACTION_TERMS = (
    "blood pressure",
    "bp",
    "labetalol",
    "nicardipine",
    "nimodipine",
    "sbp",
    "혈압",
    "니모디핀",
)
SUBARACHNOID_HEMORRHAGE_ANTICOAG_REVERSAL_SAFETY_TERMS = (
    "anticoagulant",
    "anticoagulation",
    "coagulopathy",
    "doac",
    "inr",
    "platelet",
    "reversal",
    "warfarin",
    "응고",
    "항응고",
    "혈소판",
)
SUBARACHNOID_HEMORRHAGE_REBLEED_BP_SAFETY_TERMS = (
    "blood pressure",
    "bp",
    "hypertension",
    "rebleed",
    "rebleeding",
    "secure aneurysm",
    "unsecured aneurysm",
    "재출혈",
    "혈압",
)
SUBARACHNOID_HEMORRHAGE_COMPLICATION_SAFETY_TERMS = (
    "delayed cerebral ischemia",
    "evd",
    "hydrocephalus",
    "icu",
    "neurocritical",
    "seizure",
    "vasospasm",
    "수두증",
    "혈관연축",
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
HYPERKALEMIA_CONTEXT_TERMS = (
    "ecg changes from hyperkalemia",
    "hyperkalemic emergency",
    "hyperkalemic urgency",
    "k 6.5",
    "k 7",
    "k+ 6.5",
    "k+ 7",
    "peaked t waves",
    "severe hyperkalemia",
    "sine wave",
    "wide qrs",
    "고칼륨혈증",
    "넓은 qrs",
    "뾰족 t파",
)
HYPERKALEMIA_CALCIUM_ACTION_TERMS = (
    "calcium chloride",
    "calcium gluconate",
    "cardiac membrane",
    "iv calcium",
    "membrane stabilization",
    "칼슘",
)
HYPERKALEMIA_SHIFT_ACTION_TERMS = (
    "albuterol",
    "dextrose",
    "glucose",
    "insulin",
    "salbutamol",
    "포도당",
    "인슐린",
)
HYPERKALEMIA_REMOVAL_ACTION_TERMS = (
    "dialysis",
    "diuretic",
    "hemodialysis",
    "potassium binder",
    "potassium removal",
    "sodium zirconium",
    "칼륨 제거",
    "투석",
)
HYPERKALEMIA_ECG_MONITORING_SAFETY_TERMS = (
    "arrhythmia",
    "cardiac monitor",
    "ecg",
    "repeat potassium",
    "telemetry",
    "심전도",
    "재검",
)
HYPERKALEMIA_GLUCOSE_SAFETY_TERMS = (
    "blood glucose",
    "dextrose",
    "glucose",
    "hypoglycemia",
    "포도당",
    "저혈당",
    "혈당",
)
HYPERKALEMIA_RECURRENCE_SAFETY_TERMS = (
    "ace inhibitor",
    "arb",
    "dialysis",
    "kidney",
    "medication review",
    "potassium supplement",
    "renal",
    "spironolactone",
    "신장",
    "투석",
)
STATUS_EPILEPTICUS_CONTEXT_TERMS = (
    "convulsive status epilepticus",
    "continuous seizure",
    "ongoing seizure",
    "prolonged seizure",
    "refractory status epilepticus",
    "status epilepticus",
    "status seizure",
    "발작지속",
    "지속 발작",
)
STATUS_EPILEPTICUS_AIRWAY_ACTION_TERMS = (
    "airway",
    "breathing",
    "intubation",
    "oxygen",
    "suction",
    "기도",
    "산소",
    "삽관",
)
STATUS_EPILEPTICUS_BENZO_ACTION_TERMS = (
    "benzodiazepine",
    "diazepam",
    "lorazepam",
    "midazolam",
    "벤조디아제핀",
    "로라제팜",
    "미다졸람",
)
STATUS_EPILEPTICUS_SECOND_LINE_ACTION_TERMS = (
    "antiseizure loading",
    "fosphenytoin",
    "levetiracetam",
    "phenobarbital",
    "phenytoin",
    "second-line",
    "valproate",
    "항경련제",
)
STATUS_EPILEPTICUS_REFRACTORY_ACTION_TERMS = (
    "anesthetic infusion",
    "continuous eeg",
    "icu",
    "intubation",
    "neurology",
    "propofol",
    "refractory",
    "midazolam infusion",
    "뇌파",
    "중환자",
)
STATUS_EPILEPTICUS_GLUCOSE_SAFETY_TERMS = (
    "dextrose",
    "glucose",
    "hypoglycemia",
    "thiamine",
    "저혈당",
    "티아민",
    "혈당",
)
STATUS_EPILEPTICUS_RESPIRATORY_SAFETY_TERMS = (
    "airway",
    "aspiration",
    "oxygen saturation",
    "respiratory depression",
    "ventilation",
    "기도",
    "호흡억제",
)
STATUS_EPILEPTICUS_ASM_SAFETY_TERMS = (
    "dose",
    "dosing",
    "ecg",
    "hepatic",
    "hypotension",
    "liver",
    "pregnancy",
    "renal",
    "valproate",
    "weight",
    "간기능",
    "신장",
    "용량",
    "임신",
    "체중",
)
ADRENAL_CRISIS_CONTEXT_TERMS = (
    "acute adrenal insufficiency",
    "addisonian crisis",
    "adrenal crisis",
    "adrenal insufficiency with hypotension",
    "adrenal insufficiency with shock",
    "steroid-dependent with shock",
    "부신 위기",
    "부신기능부전",
)
ADRENAL_CRISIS_STEROID_ACTION_TERMS = (
    "glucocorticoid",
    "hydrocortisone",
    "parenteral steroid",
    "stress dose",
    "steroid",
    "하이드로코르티손",
    "스테로이드",
)
ADRENAL_CRISIS_FLUID_GLUCOSE_ACTION_TERMS = (
    "0.9% saline",
    "dextrose",
    "fluid resuscitation",
    "glucose",
    "isotonic saline",
    "normal saline",
    "saline",
    "수액",
    "생리식염수",
    "포도당",
)
ADRENAL_CRISIS_MONITORING_ACTION_TERMS = (
    "blood pressure",
    "electrolyte",
    "glucose",
    "hemodynamic",
    "hypoglycemia",
    "potassium",
    "sodium",
    "shock",
    "전해질",
    "혈당",
    "혈압",
)
ADRENAL_CRISIS_DO_NOT_DELAY_SAFETY_TERMS = (
    "before cortisol",
    "cortisol",
    "do not delay",
    "draw cortisol",
    "immediate hydrocortisone",
    "not delay",
    "지연",
    "코르티솔",
)
ADRENAL_CRISIS_MONITORING_SAFETY_TERMS = (
    "blood pressure",
    "electrolyte",
    "glucose",
    "hypoglycemia",
    "hyponatremia",
    "potassium",
    "sodium",
    "혈당",
    "혈압",
    "전해질",
)
ADRENAL_CRISIS_PRECIPITANT_SAFETY_TERMS = (
    "infection",
    "missed steroid",
    "precipitant",
    "sepsis",
    "steroid withdrawal",
    "stress dosing",
    "trigger",
    "감염",
    "유발",
    "중단",
)
ACETAMINOPHEN_TOXICITY_CONTEXT_TERMS = (
    "acetaminophen overdose",
    "acetaminophen poisoning",
    "acetaminophen toxicity",
    "apap overdose",
    "apap poisoning",
    "paracetamol overdose",
    "paracetamol poisoning",
    "tylenol overdose",
    "아세트아미노펜",
)
ACETAMINOPHEN_LEVEL_NOMOGRAM_ACTION_TERMS = (
    "4 hour",
    "4-hour",
    "acetaminophen concentration",
    "acetaminophen level",
    "apap level",
    "nomogram",
    "paracetamol concentration",
    "paracetamol level",
    "rumack",
)
ACETAMINOPHEN_NAC_ACTION_TERMS = (
    "acetylcysteine",
    "n-acetylcysteine",
    "nac",
    "엔아세틸시스테인",
)
ACETAMINOPHEN_HEPATIC_TOX_ACTION_TERMS = (
    "alt",
    "ast",
    "hepatic",
    "inr",
    "lft",
    "liver",
    "poison center",
    "poison control",
    "toxicologist",
    "transplant",
    "간",
    "독성",
)
ACETAMINOPHEN_TIMING_FORMULATION_SAFETY_TERMS = (
    "co-ingestion",
    "coingestion",
    "extended release",
    "extended-release",
    "repeated supratherapeutic",
    "staggered",
    "time of ingestion",
    "unknown time",
    "복용 시간",
    "서방",
)
ACETAMINOPHEN_NAC_SAFETY_TERMS = (
    "anaphylactoid",
    "dose",
    "dosing",
    "infusion",
    "weight",
    "용량",
    "체중",
)
ACETAMINOPHEN_HEPATIC_FAILURE_SAFETY_TERMS = (
    "acidosis",
    "alt",
    "ast",
    "encephalopathy",
    "hepatic failure",
    "hypoglycemia",
    "inr",
    "liver failure",
    "transplant",
    "간부전",
    "저혈당",
)
TOXIC_ALCOHOL_CONTEXT_TERMS = (
    "antifreeze ingestion",
    "ethylene glycol",
    "methanol",
    "toxic alcohol",
    "washer fluid ingestion",
    "windshield washer fluid",
    "부동액",
    "메탄올",
)
TOXIC_ALCOHOL_GAP_LAB_ACTION_TERMS = (
    "anion gap",
    "ethylene glycol level",
    "methanol level",
    "osmol gap",
    "osmolal gap",
    "osmolar gap",
    "serum osmolality",
    "toxic alcohol level",
    "음이온차",
)
TOXIC_ALCOHOL_ANTIDOTE_ACTION_TERMS = (
    "alcohol dehydrogenase",
    "ethanol antidote",
    "fomepizole",
    "포메피졸",
)
TOXIC_ALCOHOL_DIALYSIS_ESCALATION_ACTION_TERMS = (
    "dialysis",
    "extracorporeal",
    "hemodialysis",
    "nephrology",
    "poison center",
    "poison control",
    "toxicologist",
    "투석",
)
TOXIC_ALCOHOL_ACIDOSIS_SUPPORT_ACTION_TERMS = (
    "acidosis",
    "bicarbonate",
    "blood gas",
    "ph",
    "sodium bicarbonate",
    "중탄산",
    "산증",
)
TOXIC_ALCOHOL_DIALYSIS_INDICATION_SAFETY_TERMS = (
    "anion gap",
    "coma",
    "dialysis indication",
    "hemodialysis indication",
    "kidney failure",
    "renal failure",
    "seizure",
    "severe acidosis",
    "visual",
    "투석",
    "시력",
)
TOXIC_ALCOHOL_ORGAN_INJURY_SAFETY_TERMS = (
    "calcium oxalate",
    "hypocalcemia",
    "kidney",
    "optic",
    "renal",
    "urine",
    "vision",
    "visual",
    "신장",
    "시력",
)
TOXIC_ALCOHOL_COINGESTION_DIFFERENTIAL_SAFETY_TERMS = (
    "alcoholic ketoacidosis",
    "co-ingestion",
    "coingestion",
    "diabetic ketoacidosis",
    "ethanol",
    "isopropanol",
    "lactic acidosis",
    "late presentation",
    "salicylate",
    "동반",
)
SALICYLATE_TOXICITY_CONTEXT_TERMS = (
    "aspirin overdose",
    "aspirin poisoning",
    "aspirin toxicity",
    "methyl salicylate",
    "oil of wintergreen",
    "salicylate overdose",
    "salicylate poisoning",
    "salicylate toxicity",
    "살리실산",
    "아스피린",
)
SALICYLATE_LEVEL_ACID_BASE_ACTION_TERMS = (
    "abg",
    "anion gap",
    "blood gas",
    "electrolyte",
    "repeat level",
    "salicylate concentration",
    "salicylate level",
    "serial level",
    "vbg",
    "살리실산 농도",
)
SALICYLATE_DECONTAMINATION_ACTION_TERMS = (
    "activated charcoal",
    "charcoal",
    "multidose charcoal",
    "multiple-dose charcoal",
    "활성탄",
)
SALICYLATE_ALKALINIZATION_ACTION_TERMS = (
    "alkaline diuresis",
    "alkalinization",
    "bicarbonate",
    "potassium",
    "sodium bicarbonate",
    "urine ph",
    "urinary alkalinization",
    "중탄산",
)
SALICYLATE_DIALYSIS_ESCALATION_ACTION_TERMS = (
    "dialysis",
    "hemodialysis",
    "nephrology",
    "poison center",
    "poison control",
    "toxicologist",
    "투석",
)
SALICYLATE_DIALYSIS_INDICATION_SAFETY_TERMS = (
    "acidemia",
    "altered mental status",
    "high level",
    "kidney failure",
    "pulmonary edema",
    "renal failure",
    "seizure",
    "severe acidosis",
    "very high",
    "투석",
)
SALICYLATE_INTUBATION_PH_SAFETY_TERMS = (
    "bicarbonate bolus",
    "hyperventilation",
    "intubation",
    "mechanical ventilation",
    "ph",
    "respiratory alkalosis",
    "ventilator",
    "삽관",
)
SALICYLATE_ELECTROLYTE_GLUCOSE_SAFETY_TERMS = (
    "cerebral edema",
    "glucose",
    "hypoglycemia",
    "hypokalemia",
    "potassium",
    "pulmonary edema",
    "temperature",
    "전해질",
    "칼륨",
    "혈당",
)
CARBON_MONOXIDE_CONTEXT_TERMS = (
    "carbon monoxide poisoning",
    "carbon monoxide toxicity",
    "carboxyhemoglobin",
    "co poisoning",
    "generator exhaust",
    "smoke inhalation with headache",
    "일산화탄소",
)
CARBON_MONOXIDE_REMOVAL_OXYGEN_ACTION_TERMS = (
    "100% oxygen",
    "high flow oxygen",
    "high-flow oxygen",
    "non-rebreather",
    "oxygen",
    "remove from source",
    "source removal",
    "산소",
)
CARBON_MONOXIDE_COHB_DIAGNOSTIC_ACTION_TERMS = (
    "carboxyhemoglobin",
    "co-oximetry",
    "cohb",
    "venous blood gas",
    "vbg",
    "혈중 일산화탄소",
)
CARBON_MONOXIDE_HYPERBARIC_ACTION_TERMS = (
    "hyperbaric",
    "hbo",
    "hbot",
    "poison center",
    "poison control",
    "toxicologist",
    "고압산소",
)
CARBON_MONOXIDE_CARDIAC_NEURO_ACTION_TERMS = (
    "altered mental status",
    "cardiac",
    "ecg",
    "lactate",
    "neurologic",
    "seizure",
    "syncope",
    "troponin",
    "의식",
    "심전도",
)
CARBON_MONOXIDE_PULSE_OX_SAFETY_TERMS = (
    "false normal",
    "falsely normal",
    "normal pulse ox",
    "normal pulse oximetry",
    "pulse ox",
    "pulse oximetry",
    "spo2",
    "산소포화도",
)
CARBON_MONOXIDE_HBO_CRITERIA_SAFETY_TERMS = (
    "acidosis",
    "cardiac ischemia",
    "carboxyhemoglobin",
    "cohb",
    "hyperbaric",
    "loss of consciousness",
    "neurologic",
    "pregnancy",
    "syncope",
    "임신",
)
CARBON_MONOXIDE_COMPLICATION_SAFETY_TERMS = (
    "arrhythmia",
    "cardiac",
    "delayed neurologic",
    "ecg",
    "lactate",
    "metabolic acidosis",
    "myocardial",
    "neurocognitive",
    "troponin",
    "심근",
    "신경",
)
CARBON_MONOXIDE_CYANIDE_SMOKE_SAFETY_TERMS = (
    "burn",
    "cyanide",
    "hydroxocobalamin",
    "lactate",
    "smoke inhalation",
    "화재",
    "시안화",
)
CYANIDE_POISONING_CONTEXT_TERMS = (
    "acetonitrile",
    "cyanide poisoning",
    "cyanide toxicity",
    "hydrogen cyanide",
    "smoke inhalation with lactic acidosis",
    "smoke inhalation with shock",
    "시안화",
)
CYANIDE_REMOVAL_OXYGEN_SUPPORT_ACTION_TERMS = (
    "100% oxygen",
    "circulatory support",
    "high-flow oxygen",
    "oxygen",
    "remove from source",
    "respiratory support",
    "source removal",
    "산소",
)
CYANIDE_HYDROXOCOBALAMIN_ACTION_TERMS = (
    "cyanokit",
    "hydroxocobalamin",
    "sodium thiosulfate",
    "thiosulfate",
    "하이드록소코발라민",
)
CYANIDE_LACTATE_ACIDOSIS_ACTION_TERMS = (
    "abg",
    "anion gap",
    "blood gas",
    "lactate",
    "metabolic acidosis",
    "ph",
    "vbg",
    "젖산",
    "산증",
)
CYANIDE_POISON_ESCALATION_ACTION_TERMS = (
    "burn center",
    "icu",
    "poison center",
    "poison control",
    "toxicologist",
    "중환자",
)
CYANIDE_DO_NOT_WAIT_LEVEL_SAFETY_TERMS = (
    "cyanide level",
    "do not delay",
    "do not wait",
    "empiric",
    "not delay",
    "지연",
)
CYANIDE_SMOKE_CO_NITRITE_SAFETY_TERMS = (
    "carbon monoxide",
    "co poisoning",
    "carboxyhemoglobin",
    "cohb",
    "nitrite",
    "smoke inhalation",
    "시안화",
    "일산화탄소",
)
CYANIDE_SHOCK_NEURO_SAFETY_TERMS = (
    "altered mental status",
    "cardiac arrest",
    "coma",
    "hypotension",
    "seizure",
    "shock",
    "syncope",
    "의식",
    "쇼크",
)
CYANIDE_HYDROXOCOBALAMIN_EFFECT_SAFETY_TERMS = (
    "blood pressure",
    "chromaturia",
    "dialysis",
    "hypertension",
    "lab interference",
    "red urine",
    "혈압",
)
OPIOID_TOXICITY_CONTEXT_TERMS = (
    "fentanyl overdose",
    "heroin overdose",
    "methadone overdose",
    "opiate overdose",
    "opiate toxicity",
    "opioid overdose",
    "opioid poisoning",
    "opioid toxicity",
    "opioid-induced respiratory depression",
    "naloxone",
    "narcan",
    "마약성 진통제",
    "오피오이드",
)
OPIOID_AIRWAY_VENTILATION_ACTION_TERMS = (
    "airway",
    "bag-valve",
    "bag valve",
    "bvm",
    "intubation",
    "oxygen",
    "positive pressure",
    "respiratory support",
    "ventilation",
    "기도",
    "산소",
    "환기",
)
OPIOID_NALOXONE_ACTION_TERMS = (
    "naloxone",
    "narcan",
    "opioid antagonist",
    "날록손",
)
OPIOID_RECURRENT_DEPRESSION_ACTION_TERMS = (
    "capnography",
    "continuous monitoring",
    "infusion",
    "long-acting",
    "methadone",
    "observation",
    "observe",
    "pulse oximetry",
    "recurrent",
    "repeat dose",
    "repeat naloxone",
    "renarcotization",
    "respiratory depression",
    "재호흡억제",
    "재투여",
)
OPIOID_LONG_ACTING_REBOUND_SAFETY_TERMS = (
    "extended release",
    "extended-release",
    "fentanyl",
    "long-acting",
    "methadone",
    "observation",
    "rebound",
    "recurrent",
    "renarcotization",
    "sustained release",
    "서방",
    "재호흡억제",
)
OPIOID_COINGESTION_DIFFERENTIAL_SAFETY_TERMS = (
    "alcohol",
    "benzodiazepine",
    "co-ingestion",
    "coingestion",
    "glucose",
    "hypoglycemia",
    "sedative",
    "trauma",
    "벤조디아제핀",
    "혈당",
)
OPIOID_NALOXONE_ADVERSE_SAFETY_TERMS = (
    "acute withdrawal",
    "aspiration",
    "pulmonary edema",
    "titrate",
    "titration",
    "withdrawal",
    "금단",
    "폐부종",
)
SEVERE_ASTHMA_CONTEXT_TERMS = (
    "acute asthma exacerbation",
    "asthma attack",
    "asthma exacerbation",
    "life-threatening asthma",
    "near-fatal asthma",
    "severe asthma",
    "severe bronchospasm",
    "status asthmaticus",
    "천식 발작",
    "천식 악화",
    "중증 천식",
)
SEVERE_ASTHMA_OXYGEN_VENTILATION_ACTION_TERMS = (
    "airway",
    "hypoxemia",
    "hypoxia",
    "intubation",
    "oxygen",
    "respiratory failure",
    "ventilation",
    "기도",
    "산소",
    "저산소",
    "환기",
)
SEVERE_ASTHMA_SABA_ACTION_TERMS = (
    "albuterol",
    "beta-agonist",
    "bronchodilator",
    "continuous nebulization",
    "levalbuterol",
    "saba",
    "salbutamol",
    "short-acting beta",
    "네뷸",
    "살부타몰",
)
SEVERE_ASTHMA_IPRATROPIUM_ACTION_TERMS = (
    "anticholinergic",
    "ipratropium",
    "이프라트로피움",
)
SEVERE_ASTHMA_STEROID_ACTION_TERMS = (
    "corticosteroid",
    "dexamethasone",
    "glucocorticoid",
    "methylprednisolone",
    "prednisone",
    "steroid",
    "스테로이드",
)
SEVERE_ASTHMA_ESCALATION_ACTION_TERMS = (
    "heliox",
    "icu",
    "intubation",
    "magnesium",
    "mechanical ventilation",
    "noninvasive ventilation",
    "respiratory failure",
    "마그네슘",
    "삽관",
    "중환자",
)
SEVERE_ASTHMA_RESPONSE_MONITORING_SAFETY_TERMS = (
    "fev1",
    "peak flow",
    "pef",
    "pulse oximetry",
    "reassessment",
    "response",
    "serial",
    "work of breathing",
    "산소포화도",
    "재평가",
)
SEVERE_ASTHMA_RESPIRATORY_FAILURE_SAFETY_TERMS = (
    "altered mental status",
    "co2",
    "drowsiness",
    "fatigue",
    "hypercapnia",
    "intubation",
    "respiratory failure",
    "silent chest",
    "ventilation",
    "의식",
    "호흡부전",
)
SEVERE_ASTHMA_TREATMENT_ADVERSE_SAFETY_TERMS = (
    "arrhythmia",
    "hypokalemia",
    "lactic acidosis",
    "potassium",
    "tachycardia",
    "theophylline",
    "trigger",
    "전해질",
    "저칼륨",
)
SEVERE_CAP_CONTEXT_TERMS = (
    "cap with hypoxemia",
    "cap with respiratory failure",
    "community-acquired pneumonia with hypoxemia",
    "community-acquired pneumonia with sepsis",
    "pneumonia with hypoxemia",
    "pneumonia with respiratory failure",
    "pneumonia with sepsis",
    "severe cap",
    "severe community-acquired pneumonia",
    "severe pneumonia",
    "중증 폐렴",
)
SEVERE_CAP_OXYGEN_VENTILATION_ACTION_TERMS = (
    "airway",
    "high-flow nasal cannula",
    "hfnc",
    "hypoxemia",
    "intubation",
    "oxygen",
    "respiratory failure",
    "ventilation",
    "산소",
    "저산소",
)
SEVERE_CAP_DIAGNOSTIC_CULTURE_ACTION_TERMS = (
    "blood culture",
    "blood cultures",
    "chest x-ray",
    "chest radiograph",
    "legionella",
    "respiratory culture",
    "sputum culture",
    "urinary antigen",
    "배양",
)
SEVERE_CAP_EMPIRIC_ANTIBIOTIC_ACTION_TERMS = (
    "antibiotic",
    "azithromycin",
    "beta-lactam",
    "ceftriaxone",
    "cefotaxime",
    "ceftaroline",
    "levofloxacin",
    "macrolide",
    "moxifloxacin",
    "항생제",
)
SEVERE_CAP_SEPSIS_ESCALATION_ACTION_TERMS = (
    "icu",
    "lactate",
    "sepsis",
    "septic shock",
    "shock",
    "vasopressor",
    "중환자",
    "쇼크",
)
SEVERE_CAP_MRSA_PSEUDOMONAS_SAFETY_TERMS = (
    "90 days",
    "de-escalation",
    "mrsa",
    "pseudomonas",
    "recent hospitalization",
    "respiratory isolation",
    "risk factor",
    "vancomycin",
)
SEVERE_CAP_SEVERITY_DISPOSITION_SAFETY_TERMS = (
    "curb-65",
    "hypotension",
    "icu",
    "major criteria",
    "minor criteria",
    "psi",
    "severity",
    "shock",
)
SEVERE_CAP_EFFUSION_EMPYEMA_SAFETY_TERMS = (
    "drainage",
    "empyema",
    "loculated",
    "parapneumonic effusion",
    "pleural effusion",
    "thoracentesis",
    "흉수",
)
SEVERE_CAP_VIRAL_ASPIRATION_DIFFERENTIAL_SAFETY_TERMS = (
    "aspiration",
    "covid",
    "influenza",
    "lung abscess",
    "pulmonary embolism",
    "viral",
    "virus",
    "흡인",
)
COPD_EXACERBATION_CONTEXT_TERMS = (
    "acute exacerbation of copd",
    "aecopd",
    "chronic bronchitis exacerbation",
    "chronic obstructive pulmonary disease exacerbation",
    "copd exacerbation",
    "copd flare",
    "emphysema exacerbation",
    "hypercapnic copd",
    "만성폐쇄성폐질환",
)
COPD_CONTROLLED_OXYGEN_ACTION_TERMS = (
    "88",
    "92",
    "controlled oxygen",
    "oxygen target",
    "spo2",
    "target saturation",
    "venturi",
    "산소",
)
COPD_BRONCHODILATOR_ACTION_TERMS = (
    "albuterol",
    "bronchodilator",
    "ipratropium",
    "saba",
    "salbutamol",
    "sama",
    "short-acting anticholinergic",
    "short-acting beta",
    "이프라트로피움",
    "기관지확장",
)
COPD_STEROID_ACTION_TERMS = (
    "corticosteroid",
    "glucocorticoid",
    "methylprednisolone",
    "prednisone",
    "steroid",
    "스테로이드",
)
COPD_ANTIBIOTIC_CRITERIA_ACTION_TERMS = (
    "antibiotic",
    "infection",
    "pneumonia",
    "purulent sputum",
    "sputum purulence",
    "감염",
    "항생제",
)
COPD_VENTILATORY_SUPPORT_ACTION_TERMS = (
    "bipap",
    "hypercapnia",
    "intubation",
    "niv",
    "noninvasive ventilation",
    "non-invasive ventilation",
    "respiratory acidosis",
    "respiratory failure",
    "기계환기",
    "비침습",
    "삽관",
)
COPD_OXYGEN_CO2_SAFETY_TERMS = (
    "88",
    "92",
    "abg",
    "arterial blood gas",
    "co2",
    "controlled oxygen",
    "hypercapnia",
    "oxygen-induced",
    "paco2",
    "ph",
    "venturi",
    "동맥혈",
    "이산화탄소",
)
COPD_NIV_INTUBATION_SAFETY_TERMS = (
    "abg",
    "altered mental status",
    "bipap",
    "fatigue",
    "hypercapnic acidosis",
    "intubation",
    "niv",
    "noninvasive ventilation",
    "ph",
    "respiratory acidosis",
    "respiratory failure",
    "의식",
    "삽관",
    "호흡부전",
)
COPD_COMORBID_DIFFERENTIAL_SAFETY_TERMS = (
    "acute heart failure",
    "arrhythmia",
    "bronchiectasis",
    "pneumonia",
    "pneumothorax",
    "pulmonary embolism",
    "trigger",
    "감별",
    "폐렴",
)
COPD_TREATMENT_ADVERSE_SAFETY_TERMS = (
    "arrhythmia",
    "glucose",
    "hyperglycemia",
    "hypokalemia",
    "potassium",
    "steroid",
    "tachycardia",
    "전해질",
    "혈당",
)
ACUTE_HEART_FAILURE_CONTEXT_TERMS = (
    "acute decompensated heart failure",
    "acute heart failure",
    "acute pulmonary edema",
    "cardiogenic pulmonary edema",
    "decompensated heart failure",
    "flash pulmonary edema",
    "heart failure exacerbation",
    "hypertensive pulmonary edema",
    "pulmonary oedema",
    "심부전",
    "폐부종",
)
ACUTE_HF_OXYGEN_NIV_ACTION_TERMS = (
    "bipap",
    "cpap",
    "hypoxemia",
    "intubation",
    "niv",
    "noninvasive ventilation",
    "non-invasive ventilation",
    "oxygen",
    "positive pressure",
    "ventilation",
    "산소",
    "양압",
    "환기",
)
ACUTE_HF_DIURETIC_ACTION_TERMS = (
    "bumetanide",
    "decongestion",
    "diuretic",
    "furosemide",
    "loop diuretic",
    "torsemide",
    "이뇨",
)
ACUTE_HF_VASODILATOR_BP_ACTION_TERMS = (
    "afterload",
    "blood pressure",
    "hypertensive",
    "nitroglycerin",
    "nitrate",
    "nitroprusside",
    "vasodilator",
    "혈압",
    "혈관확장",
)
ACUTE_HF_ESCALATION_ACTION_TERMS = (
    "cardiogenic shock",
    "icu",
    "inotrope",
    "intubation",
    "mechanical ventilation",
    "pressor",
    "respiratory failure",
    "shock",
    "vasopressor",
    "기계환기",
    "삽관",
    "쇼크",
    "중환자",
)
ACUTE_HF_BP_VASODILATOR_SAFETY_TERMS = (
    "aortic stenosis",
    "blood pressure",
    "hypotension",
    "nitrate",
    "right ventricular infarct",
    "sildenafil",
    "vasodilator",
    "저혈압",
    "혈압",
)
ACUTE_HF_RENAL_ELECTROLYTE_SAFETY_TERMS = (
    "creatinine",
    "electrolyte",
    "hypokalemia",
    "kidney",
    "magnesium",
    "potassium",
    "renal",
    "urine output",
    "신장",
    "전해질",
)
ACUTE_HF_TRIGGER_DIFFERENTIAL_SAFETY_TERMS = (
    "acute coronary syndrome",
    "arrhythmia",
    "infection",
    "ischemia",
    "myocardial infarction",
    "pulmonary embolism",
    "trigger",
    "valvular",
    "감염",
    "부정맥",
    "심근경색",
)
ACUTE_HF_SHOCK_RESPIRATORY_FAILURE_SAFETY_TERMS = (
    "altered mental status",
    "cardiogenic shock",
    "hypoperfusion",
    "hypotension",
    "intubation",
    "lactate",
    "respiratory failure",
    "shock",
    "저관류",
    "쇼크",
    "호흡부전",
)
CARDIAC_TAMPONADE_CONTEXT_TERMS = (
    "beck triad",
    "beck's triad",
    "cardiac tamponade",
    "pericardial tamponade",
    "pericardial effusion with shock",
    "pulsus paradoxus",
    "tamponade physiology",
    "심장눌림증",
    "심낭압전",
)
CARDIAC_TAMPONADE_ECHO_ACTION_TERMS = (
    "bedside echo",
    "bedside ultrasound",
    "cardiac pocus",
    "echocardiography",
    "echo",
    "pocus",
    "ultrasound",
    "심초음파",
    "초음파",
)
CARDIAC_TAMPONADE_DRAINAGE_ACTION_TERMS = (
    "pericardiocentesis",
    "pericardial drainage",
    "pericardial window",
    "pericardiotomy",
    "subxiphoid",
    "심낭천자",
    "심낭 배액",
)
CARDIAC_TAMPONADE_SPECIALIST_ACTION_TERMS = (
    "cardiology",
    "cardiothoracic",
    "ct surgery",
    "emergency surgery",
    "trauma surgery",
    "thoracic surgery",
    "흉부외과",
    "심장내과",
)
CARDIAC_TAMPONADE_HEMODYNAMIC_ACTION_TERMS = (
    "blood pressure",
    "fluid bolus",
    "hemodynamic",
    "hypotension",
    "pressor",
    "shock",
    "vasopressor",
    "수액",
    "쇼크",
    "혈압",
)
CARDIAC_TAMPONADE_NO_DELAY_SAFETY_TERMS = (
    "clinical diagnosis",
    "do not delay",
    "do not wait",
    "immediate drainage",
    "unstable",
    "urgent drainage",
    "지연",
)
CARDIAC_TAMPONADE_ANTICOAG_REVERSAL_SAFETY_TERMS = (
    "anticoagulant",
    "anticoagulation",
    "bleeding",
    "coagulopathy",
    "doac",
    "inr",
    "platelet",
    "reversal",
    "thrombolysis",
    "warfarin",
    "출혈",
    "항응고",
)
CARDIAC_TAMPONADE_CAUSE_COMPLICATION_SAFETY_TERMS = (
    "aortic dissection",
    "iatrogenic",
    "malignancy",
    "myocardial infarction",
    "myocardial rupture",
    "renal failure",
    "trauma",
    "uremia",
    "감별",
    "외상",
)
TENSION_PNEUMOTHORAX_CONTEXT_TERMS = (
    "tension pneumothorax",
    "tension physiology",
    "traumatic pneumothorax with shock",
    "unstable pneumothorax",
    "긴장성 기흉",
)
TENSION_PNEUMOTHORAX_DECOMPRESSION_ACTION_TERMS = (
    "chest decompression",
    "finger thoracostomy",
    "needle decompression",
    "needle thoracostomy",
    "thoracostomy",
    "감압",
    "흉강천자",
)
TENSION_PNEUMOTHORAX_CHEST_TUBE_ACTION_TERMS = (
    "chest drain",
    "chest tube",
    "tube thoracostomy",
    "thoracostomy tube",
    "흉관",
)
TENSION_PNEUMOTHORAX_AIRWAY_OXYGEN_ACTION_TERMS = (
    "airway",
    "bag-valve",
    "bvm",
    "oxygen",
    "respiratory failure",
    "ventilation",
    "기도",
    "산소",
    "환기",
)
TENSION_PNEUMOTHORAX_REASSESSMENT_ACTION_TERMS = (
    "breath sounds",
    "hemodynamic",
    "imaging after",
    "lung sliding",
    "reassessment",
    "repeat exam",
    "ultrasound",
    "vital signs",
    "재평가",
)
TENSION_PNEUMOTHORAX_NO_DELAY_SAFETY_TERMS = (
    "clinical diagnosis",
    "do not delay",
    "do not wait",
    "imaging",
    "unstable",
    "x-ray",
    "지연",
)
TENSION_PNEUMOTHORAX_SITE_TECHNIQUE_SAFETY_TERMS = (
    "4th intercostal",
    "5th intercostal",
    "axillary",
    "large-bore",
    "midaxillary",
    "midclavicular",
    "site",
    "sterile",
    "technique",
    "위치",
)
TENSION_PNEUMOTHORAX_RECURRENCE_FAILURE_SAFETY_TERMS = (
    "catheter failure",
    "chest tube patency",
    "persistent air leak",
    "recurrent",
    "reexpansion",
    "repeat decompression",
    "specialty consultation",
    "tube position",
    "재발",
)
TENSION_PNEUMOTHORAX_DIFFERENTIAL_SAFETY_TERMS = (
    "cardiac tamponade",
    "hemothorax",
    "massive hemothorax",
    "obstructive shock",
    "pulmonary embolism",
    "shock",
    "trauma",
    "감별",
    "쇼크",
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
AORTIC_DISSECTION_CONTEXT_TERMS = (
    "acute aortic syndrome",
    "aortic dissection",
    "ascending aortic dissection",
    "stanford type a",
    "stanford type b",
    "type a dissection",
    "type b dissection",
    "대동맥박리",
    "대동맥 박리",
)
AORTIC_DISSECTION_IMAGING_ACTION_TERMS = (
    "ct angiography",
    "cta",
    "mra",
    "tee",
    "transesophageal echo",
    "transesophageal echocardiography",
    "대동맥 조영",
    "식도초음파",
    "조영 ct",
)
AORTIC_DISSECTION_ANTI_IMPULSE_ACTION_TERMS = (
    "anti-impulse",
    "beta blocker",
    "beta-blocker",
    "blood pressure",
    "esmolol",
    "heart rate",
    "impulse",
    "labetalol",
    "pain control",
    "sbp",
    "베타차단제",
    "심박",
    "진통",
    "혈압",
)
AORTIC_DISSECTION_SURGICAL_ACTION_TERMS = (
    "aortic team",
    "cardiothoracic",
    "surgery",
    "surgical",
    "transfer",
    "type a",
    "vascular surgery",
    "대동맥팀",
    "심장외과",
    "수술",
    "전원",
    "혈관외과",
)
AORTIC_DISSECTION_ANTITHROMBOTIC_SAFETY_TERMS = (
    "anticoagulation",
    "anticoagulant",
    "antiplatelet",
    "avoid thrombolysis",
    "heparin",
    "thrombolysis",
    "thrombolytic",
    "항응고",
    "항혈소판",
    "혈전용해",
)
AORTIC_DISSECTION_VASODILATOR_SAFETY_TERMS = (
    "beta blocker before vasodilator",
    "beta-blocker before vasodilator",
    "esmolol",
    "heart rate",
    "reflex tachycardia",
    "vasodilator",
    "베타차단제",
    "혈관확장제",
)
AORTIC_DISSECTION_COMPLICATION_SAFETY_TERMS = (
    "aortic regurgitation",
    "branch vessel",
    "malperfusion",
    "neurologic deficit",
    "pericardial effusion",
    "pulse deficit",
    "rupture",
    "tamponade",
    "대동맥판막",
    "맥박",
    "심낭",
    "장기허혈",
    "파열",
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

    for term in DIAGNOSIS_KOREAN_SINGLE_TOKEN_LEAK_TERMS:
        if term in normalized:
            terms.add(term)

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
            name="sepsis_resuscitation_actions",
            applies=_requires_sepsis_resuscitation_safety_check,
            field_name="time_critical_actions",
            validator=_has_sepsis_resuscitation_actions,
            issue=(
                "sepsis time-critical actions must include lactate measurement "
                "or reassessment, fluid resuscitation, and vasopressor or shock "
                "escalation planning"
            ),
        ),
        DomainSafetyGate(
            name="anaphylaxis_time_critical_actions",
            applies=_requires_anaphylaxis_safety_check,
            field_name="time_critical_actions",
            validator=_has_anaphylaxis_time_critical_actions,
            issue=(
                "anaphylaxis time-critical actions must include IM epinephrine, "
                "airway or oxygen support, and fluid or shock escalation planning"
            ),
        ),
        DomainSafetyGate(
            name="anaphylaxis_observation_safety",
            applies=_requires_anaphylaxis_safety_check,
            field_name="contraindication_checks",
            validator=_has_anaphylaxis_observation_safety_check,
            issue=(
                "anaphylaxis safety checks must include trigger or allergen exposure "
                "review and observation for biphasic reaction or recurrence"
            ),
        ),
        DomainSafetyGate(
            name="gi_bleed_time_critical_actions",
            applies=_requires_gi_bleed_safety_check,
            field_name="time_critical_actions",
            validator=_has_gi_bleed_time_critical_actions,
            issue=(
                "GI bleed time-critical actions must include hemodynamic resuscitation, "
                "blood product preparation or transfusion planning, and urgent "
                "endoscopy or source-control planning"
            ),
        ),
        DomainSafetyGate(
            name="gi_bleed_transfusion_reversal_safety",
            applies=_requires_gi_bleed_safety_check,
            field_name="contraindication_checks",
            validator=_has_gi_bleed_transfusion_reversal_safety_check,
            issue=(
                "GI bleed safety checks must include anticoagulant or coagulopathy "
                "reversal review and transfusion consent, type, or reaction safeguards"
            ),
        ),
        DomainSafetyGate(
            name="cns_infection_time_critical_actions",
            applies=_requires_cns_infection_safety_check,
            field_name="time_critical_actions",
            validator=_has_cns_infection_time_critical_actions,
            issue=(
                "CNS infection time-critical actions must include blood cultures, "
                "immediate empiric antibiotics, lumbar puncture or CT-before-LP "
                "pathway, and dexamethasone timing when bacterial meningitis is possible"
            ),
        ),
        DomainSafetyGate(
            name="cns_infection_lp_steroid_safety",
            applies=_requires_cns_infection_safety_check,
            field_name="contraindication_checks",
            validator=_has_cns_infection_lp_steroid_safety_check,
            issue=(
                "CNS infection safety checks must include antimicrobial allergy or "
                "renal dosing review, lumbar puncture contraindications, and "
                "dexamethasone timing relative to antibiotics"
            ),
        ),
        DomainSafetyGate(
            name="ectopic_pregnancy_time_critical_actions",
            applies=_requires_ectopic_pregnancy_safety_check,
            field_name="time_critical_actions",
            validator=_has_ectopic_pregnancy_time_critical_actions,
            issue=(
                "ectopic pregnancy time-critical actions must include quantitative "
                "hCG or pregnancy testing, pelvic or transvaginal ultrasound, and "
                "urgent OB/GYN or operative escalation for instability or rupture"
            ),
        ),
        DomainSafetyGate(
            name="ectopic_pregnancy_treatment_safety",
            applies=_requires_ectopic_pregnancy_safety_check,
            field_name="contraindication_checks",
            validator=_has_ectopic_pregnancy_treatment_safety_check,
            issue=(
                "ectopic pregnancy safety checks must include Rh status or anti-D "
                "planning, methotrexate eligibility or contraindications, and "
                "hemodynamic or rupture risk"
            ),
        ),
        DomainSafetyGate(
            name="severe_preeclampsia_time_critical_actions",
            applies=_requires_severe_preeclampsia_safety_check,
            field_name="time_critical_actions",
            validator=_has_severe_preeclampsia_time_critical_actions,
            issue=(
                "severe preeclampsia or eclampsia time-critical actions must "
                "include magnesium sulfate seizure prophylaxis or treatment, "
                "acute severe-hypertension treatment, delivery or maternal-fetal "
                "planning, and OB/MFM or critical-care escalation"
            ),
        ),
        DomainSafetyGate(
            name="severe_preeclampsia_treatment_safety",
            applies=_requires_severe_preeclampsia_safety_check,
            field_name="contraindication_checks",
            validator=_has_severe_preeclampsia_treatment_safety_check,
            issue=(
                "severe preeclampsia or eclampsia safety checks must include "
                "magnesium toxicity monitoring, antihypertensive contraindication "
                "review, HELLP or renal-organ labs, and maternal-fetal severe-feature "
                "or delivery-risk monitoring"
            ),
        ),
        DomainSafetyGate(
            name="hypertensive_emergency_time_critical_actions",
            applies=_requires_hypertensive_emergency_safety_check,
            field_name="time_critical_actions",
            validator=_has_hypertensive_emergency_time_critical_actions,
            issue=(
                "hypertensive emergency time-critical actions must include repeat "
                "BP confirmation or monitored-setting/ICU/telemetry/arterial-line "
                "monitoring, acute target-organ damage assessment for neurologic, "
                "renal, cardiac, pulmonary-edema, aortic-dissection, fundoscopic, "
                "ECG, troponin, creatinine, urinalysis, CT-head, or chest-x-ray "
                "findings, titratable IV antihypertensive therapy such as "
                "nicardipine, labetalol, clevidipine, esmolol, fenoldopam, "
                "nitroglycerin, or nitroprusside, and a controlled BP-lowering "
                "target such as MAP or mean arterial pressure reduction by about "
                "20-25% in the first hour without abrupt overcorrection"
            ),
        ),
        DomainSafetyGate(
            name="hypertensive_emergency_treatment_safety",
            applies=_requires_hypertensive_emergency_safety_check,
            field_name="contraindication_checks",
            validator=_has_hypertensive_emergency_treatment_safety_check,
            issue=(
                "hypertensive emergency safety checks must distinguish true "
                "emergency with acute target-organ damage from asymptomatic "
                "markedly elevated BP or hypertensive urgency, avoid overly rapid "
                "BP lowering, hypotension, cerebral hypoperfusion, or more-than-25% "
                "early reduction, review condition-specific medication choice or "
                "contraindications for aortic dissection, pulmonary edema, stroke, "
                "pregnancy, renal failure, heart failure, asthma, bradycardia, or "
                "beta-blocker use, and include ICU, monitored, continuous BP, "
                "arterial-line, telemetry, titration, or reassessment disposition"
            ),
        ),
        DomainSafetyGate(
            name="giant_cell_arteritis_time_critical_actions",
            applies=_requires_giant_cell_arteritis_safety_check,
            field_name="time_critical_actions",
            validator=_has_giant_cell_arteritis_time_critical_actions,
            issue=(
                "giant cell arteritis time-critical actions must include immediate "
                "high-dose glucocorticoid or corticosteroid therapy such as "
                "prednisone, prednisolone, or IV methylprednisolone, ESR, CRP, "
                "CBC, platelet, or inflammatory-marker testing, temporal artery "
                "biopsy, temporal artery ultrasound, color Doppler, halo-sign, "
                "or diagnostic confirmation planning, and urgent ophthalmology, "
                "rheumatology, emergency, same-day, visual-symptom, or vision-loss "
                "escalation"
            ),
        ),
        DomainSafetyGate(
            name="giant_cell_arteritis_treatment_safety",
            applies=_requires_giant_cell_arteritis_safety_check,
            field_name="contraindication_checks",
            validator=_has_giant_cell_arteritis_treatment_safety_check,
            issue=(
                "giant cell arteritis safety checks must include explicit "
                "do-not-delay, do-not-wait, immediate, same-day, or before-biopsy "
                "steroid planning, vision or cranial-ischemia risk review for "
                "amaurosis fugax, diplopia, visual disturbance, vision loss, or "
                "stroke, steroid-risk mitigation for glucose, diabetes, infection, "
                "osteoporosis, fracture, bone protection, PPI, GI, or toxicity, "
                "and follow-up planning for taper, relapse, large-vessel disease, "
                "vascular imaging, polymyalgia rheumatica, or tocilizumab"
            ),
        ),
        DomainSafetyGate(
            name="acute_angle_closure_glaucoma_time_critical_actions",
            applies=_requires_acute_angle_closure_glaucoma_safety_check,
            field_name="time_critical_actions",
            validator=_has_acute_angle_closure_glaucoma_time_critical_actions,
            issue=(
                "acute angle-closure glaucoma time-critical actions must include "
                "IOP, intraocular-pressure, tonometry, slit-lamp, or gonioscopy "
                "assessment, topical aqueous suppression with timolol, beta blocker, "
                "brimonidine, apraclonidine, dorzolamide, or topical drops, systemic "
                "IOP lowering with acetazolamide, Diamox, osmotic agent, mannitol, "
                "glycerol, or isosorbide, and urgent ophthalmology plus laser "
                "peripheral iridotomy, LPI, iridotomy, or iridectomy definitive "
                "planning"
            ),
        ),
        DomainSafetyGate(
            name="acute_angle_closure_glaucoma_treatment_safety",
            applies=_requires_acute_angle_closure_glaucoma_safety_check,
            field_name="contraindication_checks",
            validator=_has_acute_angle_closure_glaucoma_treatment_safety_check,
            issue=(
                "acute angle-closure glaucoma safety checks must include medication "
                "contraindication review for acetazolamide allergy, sulfa allergy, "
                "renal failure, timolol, asthma, COPD, bradycardia, or beta-blocker "
                "risk, pilocarpine timing or avoidance review for high IOP, corneal "
                "edema, lens-induced or phacomorphic angle closure, or pupil block, "
                "fellow-eye or bilateral prophylactic iridotomy planning, and visual "
                "acuity, optic-nerve, corneal-edema, vision-loss, repeat-IOP, or "
                "recheck-IOP monitoring"
            ),
        ),
        DomainSafetyGate(
            name="neutropenic_fever_time_critical_actions",
            applies=_requires_neutropenic_fever_safety_check,
            field_name="time_critical_actions",
            validator=_has_neutropenic_fever_time_critical_actions,
            issue=(
                "febrile neutropenia time-critical actions must include ANC or "
                "CBC confirmation, blood cultures or source cultures, immediate "
                "empiric antipseudomonal broad-spectrum antibiotics, and "
                "oncology/hematology or sepsis-risk escalation"
            ),
        ),
        DomainSafetyGate(
            name="neutropenic_fever_treatment_safety",
            applies=_requires_neutropenic_fever_safety_check,
            field_name="contraindication_checks",
            validator=_has_neutropenic_fever_treatment_safety_check,
            issue=(
                "febrile neutropenia safety checks must include antibiotic allergy "
                "or renal/hepatic dosing review, central-line or resistant-organism "
                "coverage indications, validated risk/disposition assessment, and "
                "persistent fever or fungal-risk reassessment"
            ),
        ),
        DomainSafetyGate(
            name="obstructive_pyelonephritis_time_critical_actions",
            applies=_requires_obstructive_pyelonephritis_safety_check,
            field_name="time_critical_actions",
            validator=_has_obstructive_pyelonephritis_time_critical_actions,
            issue=(
                "obstructive pyelonephritis time-critical actions must include "
                "immediate antibiotics and urine or blood cultures, CT, ultrasound, "
                "hydronephrosis, obstruction, stone, or ureteral-stone imaging, "
                "urgent urology decompression with ureteral stent, percutaneous "
                "nephrostomy, PCN, nephrostomy, drainage, or decompression, and "
                "sepsis support with fluids, lactate, shock, vasopressor, ICU, "
                "or septic-shock monitoring"
            ),
        ),
        DomainSafetyGate(
            name="obstructive_pyelonephritis_treatment_safety",
            applies=_requires_obstructive_pyelonephritis_safety_check,
            field_name="contraindication_checks",
            validator=_has_obstructive_pyelonephritis_treatment_safety_check,
            issue=(
                "obstructive pyelonephritis safety checks must include delayed "
                "definitive stone removal until infection or sepsis resolves, "
                "drainage option review for ureteral stent, retrograde stent, "
                "percutaneous nephrostomy, PCN, or nephrostomy, antibiotic "
                "reassessment with culture result, antibiogram, resistance, "
                "renal dosing, or source-control review, and complication risk "
                "review for anuria, AKI, renal failure, solitary kidney, "
                "pregnancy, immunocompromised state, urosepsis, or septic shock"
            ),
        ),
        DomainSafetyGate(
            name="severe_hypoglycemia_time_critical_actions",
            applies=_requires_severe_hypoglycemia_safety_check,
            field_name="time_critical_actions",
            validator=_has_severe_hypoglycemia_time_critical_actions,
            issue=(
                "severe hypoglycemia time-critical actions must include bedside "
                "or point-of-care glucose confirmation, immediate oral glucose, "
                "IV dextrose, or glucagon therapy, repeat glucose checks with "
                "feeding or dextrose infusion to prevent recurrence, and cause "
                "or admission escalation for prolonged-risk cases"
            ),
        ),
        DomainSafetyGate(
            name="severe_hypoglycemia_treatment_safety",
            applies=_requires_severe_hypoglycemia_safety_check,
            field_name="contraindication_checks",
            validator=_has_severe_hypoglycemia_treatment_safety_check,
            issue=(
                "severe hypoglycemia safety checks must include airway or swallow "
                "route safety, recurrent hypoglycemia risk from sulfonylurea or "
                "long-acting insulin with octreotide or observation planning, renal, "
                "hepatic, alcohol, sepsis, or adrenal cause review, and discharge "
                "prevention such as education, dose adjustment, meal access, or "
                "glucagon planning"
            ),
        ),
        DomainSafetyGate(
            name="malignant_hyperthermia_time_critical_actions",
            applies=_requires_malignant_hyperthermia_safety_check,
            field_name="time_critical_actions",
            validator=_has_malignant_hyperthermia_time_critical_actions,
            issue=(
                "malignant hyperthermia time-critical actions must include stopping "
                "triggering anesthetics or succinylcholine with high-flow oxygen or "
                "non-triggering anesthesia, immediate dantrolene, active cooling, and "
                "MH cart, hotline, ICU, or urine-output escalation"
            ),
        ),
        DomainSafetyGate(
            name="malignant_hyperthermia_treatment_safety",
            applies=_requires_malignant_hyperthermia_safety_check,
            field_name="contraindication_checks",
            validator=_has_malignant_hyperthermia_treatment_safety_check,
            issue=(
                "malignant hyperthermia safety checks must include hyperkalemia, "
                "acidosis, arrhythmia, or rhabdomyolysis monitoring, core temperature "
                "or ETCO2 and urine-output monitoring, dantrolene repeat-dose or "
                "interaction safety, and trigger-free anesthesia or susceptibility "
                "prevention planning"
            ),
        ),
        DomainSafetyGate(
            name="thyroid_storm_time_critical_actions",
            applies=_requires_thyroid_storm_safety_check,
            field_name="time_critical_actions",
            validator=_has_thyroid_storm_time_critical_actions,
            issue=(
                "thyroid storm time-critical actions must include beta-blockade "
                "or rate control, thionamide antithyroid therapy, iodine or iodide "
                "therapy, and glucocorticoid plus cooling, ICU, or supportive care"
            ),
        ),
        DomainSafetyGate(
            name="thyroid_storm_treatment_safety",
            applies=_requires_thyroid_storm_safety_check,
            field_name="contraindication_checks",
            validator=_has_thyroid_storm_treatment_safety_check,
            issue=(
                "thyroid storm safety checks must include iodine-after-thionamide "
                "sequencing, beta-blocker contraindication review, thionamide "
                "pregnancy, liver, or agranulocytosis safety, and precipitant, "
                "arrhythmia, or ICU monitoring"
            ),
        ),
        DomainSafetyGate(
            name="heat_stroke_time_critical_actions",
            applies=_requires_heat_stroke_safety_check,
            field_name="time_critical_actions",
            validator=_has_heat_stroke_time_critical_actions,
            issue=(
                "heat stroke time-critical actions must include core or rectal "
                "temperature confirmation, immediate rapid whole-body cooling, "
                "airway, oxygen, circulation, or IV-fluid resuscitation, and EMS, "
                "ICU, transfer, or organ-failure escalation"
            ),
        ),
        DomainSafetyGate(
            name="heat_stroke_treatment_safety",
            applies=_requires_heat_stroke_safety_check,
            field_name="contraindication_checks",
            validator=_has_heat_stroke_treatment_safety_check,
            issue=(
                "heat stroke safety checks must include cooling endpoint or "
                "overcooling prevention, rhabdomyolysis, renal, liver, electrolyte, "
                "or coagulation monitoring, avoidance of antipyretic-centered "
                "management, and sepsis, malignant hyperthermia, serotonin syndrome, "
                "or other dangerous hyperthermia differential review"
            ),
        ),
        DomainSafetyGate(
            name="cauda_equina_time_critical_actions",
            applies=_requires_cauda_equina_safety_check,
            field_name="time_critical_actions",
            validator=_has_cauda_equina_time_critical_actions,
            issue=(
                "cauda equina time-critical actions must include emergency "
                "lumbar MRI, bladder or post-void residual assessment, "
                "saddle, perianal, anal-tone, or lower-limb neurologic exam, "
                "and urgent neurosurgery, spine surgery, or decompression "
                "escalation"
            ),
        ),
        DomainSafetyGate(
            name="cauda_equina_delay_safety",
            applies=_requires_cauda_equina_safety_check,
            field_name="contraindication_checks",
            validator=_has_cauda_equina_delay_safety_check,
            issue=(
                "cauda equina safety checks must document bladder, bowel, "
                "saddle, sexual, or progressive neurologic red flags, avoid "
                "delayed outpatient or conservative low-back-pain management, "
                "and review spinal infection, malignancy, trauma, stenosis, "
                "or other compressive causes"
            ),
        ),
        DomainSafetyGate(
            name="acute_compartment_syndrome_time_critical_actions",
            applies=_requires_acute_compartment_syndrome_safety_check,
            field_name="time_critical_actions",
            validator=_has_acute_compartment_syndrome_time_critical_actions,
            issue=(
                "acute compartment syndrome time-critical actions must include "
                "pain-out-of-proportion, passive-stretch, tense-compartment, "
                "pulse, capillary-refill, neurovascular, or serial limb exam, "
                "intracompartmental pressure, compartment pressure, delta "
                "pressure, diastolic pressure, pressure measurement, or pressure "
                "monitoring when diagnosis is uncertain, urgent orthopedic or "
                "orthopaedic surgery consultation, fasciotomy, surgical "
                "decompression, or urgent decompression, and temporizing removal "
                "or release of cast, splint, dressing, or circumferential "
                "compression with heart-level limb positioning and blood-pressure "
                "support"
            ),
        ),
        DomainSafetyGate(
            name="acute_compartment_syndrome_treatment_safety",
            applies=_requires_acute_compartment_syndrome_safety_check,
            field_name="contraindication_checks",
            validator=_has_acute_compartment_syndrome_treatment_safety_check,
            issue=(
                "acute compartment syndrome safety checks must include explicit "
                "do-not-delay, emergent, immediate, urgent, or within-1-hour "
                "surgery planning, assessment of regional anesthesia, sedation, "
                "analgesia, consciousness, unable-to-assess status, or serial "
                "reassessment because symptoms can be masked, complication "
                "review for ischemia, muscle necrosis, nerve injury, limb loss, "
                "rhabdomyolysis, hyperkalemia, AKI, or renal failure, and cause "
                "review for fracture, crush injury, burn, cast, tight dressing, "
                "vascular injury, or reperfusion"
            ),
        ),
        DomainSafetyGate(
            name="acute_limb_ischemia_time_critical_actions",
            applies=_requires_acute_limb_ischemia_safety_check,
            field_name="time_critical_actions",
            validator=_has_acute_limb_ischemia_time_critical_actions,
            issue=(
                "acute limb ischemia time-critical actions must include "
                "pulse, Doppler, motor, sensory, 6 Ps, or Rutherford limb "
                "viability assessment, immediate IV unfractionated heparin "
                "or anticoagulation planning, and urgent vascular surgery, "
                "endovascular, thrombolysis, thrombectomy, embolectomy, "
                "bypass, or revascularization escalation"
            ),
        ),
        DomainSafetyGate(
            name="acute_limb_ischemia_treatment_safety",
            applies=_requires_acute_limb_ischemia_safety_check,
            field_name="contraindication_checks",
            validator=_has_acute_limb_ischemia_treatment_safety_check,
            issue=(
                "acute limb ischemia safety checks must include heparin, "
                "thrombolysis, bleeding, platelet, recent-surgery, or other "
                "anticoagulation contraindication review, irreversible limb, "
                "Rutherford III, compartment-syndrome, fasciotomy, or "
                "reperfusion-injury monitoring, and embolic, thrombotic, "
                "aneurysm, atrial-fibrillation, trauma, or vascular-access "
                "cause review"
            ),
        ),
        DomainSafetyGate(
            name="testicular_torsion_time_critical_actions",
            applies=_requires_testicular_torsion_safety_check,
            field_name="time_critical_actions",
            validator=_has_testicular_torsion_time_critical_actions,
            issue=(
                "testicular torsion time-critical actions must include acute "
                "scrotal assessment with high-clinical-suspicion, cremasteric, "
                "high-riding, Doppler, or ultrasound pathway, immediate urology, "
                "scrotal exploration, orchiopexy, or urgent surgical escalation, "
                "and explicit imaging-not-to-delay or immediate time-critical "
                "management"
            ),
        ),
        DomainSafetyGate(
            name="testicular_torsion_treatment_safety",
            applies=_requires_testicular_torsion_safety_check,
            field_name="contraindication_checks",
            validator=_has_testicular_torsion_treatment_safety_check,
            issue=(
                "testicular torsion safety checks must include ischemia, "
                "4-to-8-hour salvage, viability, orchiectomy, or time-from-onset "
                "risk, manual detorsion as non-definitive or not delaying surgery, "
                "bilateral or contralateral orchiopexy, fertility, or testicular "
                "loss planning, and epididymitis, torsion of appendage, hernia, "
                "trauma, or other acute-scrotum differential review"
            ),
        ),
        DomainSafetyGate(
            name="ovarian_torsion_time_critical_actions",
            applies=_requires_ovarian_torsion_safety_check,
            field_name="time_critical_actions",
            validator=_has_ovarian_torsion_time_critical_actions,
            issue=(
                "ovarian or adnexal torsion time-critical actions must include "
                "pregnancy testing or quantitative hCG, pelvic or transvaginal "
                "ultrasound with Doppler assessment, and urgent OB/GYN, diagnostic "
                "laparoscopy, detorsion, or surgical escalation"
            ),
        ),
        DomainSafetyGate(
            name="ovarian_torsion_treatment_safety",
            applies=_requires_ovarian_torsion_safety_check,
            field_name="contraindication_checks",
            validator=_has_ovarian_torsion_treatment_safety_check,
            issue=(
                "ovarian or adnexal torsion safety checks must include normal "
                "Doppler flow not ruling out torsion or imaging not delaying "
                "timely intervention, ovarian preservation, detorsion, cystectomy, "
                "fertility, or oophorectomy-limitation planning, and ectopic "
                "pregnancy, appendicitis, PID, ruptured cyst, tubo-ovarian abscess, "
                "or other acute-pelvic-pain differential review"
            ),
        ),
        DomainSafetyGate(
            name="spinal_epidural_abscess_time_critical_actions",
            applies=_requires_spinal_epidural_abscess_safety_check,
            field_name="time_critical_actions",
            validator=_has_spinal_epidural_abscess_time_critical_actions,
            issue=(
                "spinal epidural abscess time-critical actions must include "
                "urgent MRI spine or whole-spine imaging, blood cultures, ESR, "
                "CRP, source cultures, or microbiology workup, empiric IV "
                "antibiotics, and neurosurgery, spine surgery, decompression, "
                "drainage, or source-control escalation"
            ),
        ),
        DomainSafetyGate(
            name="spinal_epidural_abscess_treatment_safety",
            applies=_requires_spinal_epidural_abscess_safety_check,
            field_name="contraindication_checks",
            validator=_has_spinal_epidural_abscess_treatment_safety_check,
            issue=(
                "spinal epidural abscess safety checks must include neurologic "
                "deficit, bowel or bladder dysfunction, serial neurologic exams, "
                "or sepsis monitoring, bacteremia, endocarditis, diabetes, IVDU, "
                "immunosuppression, recent spinal procedure, staphylococcal, or "
                "source-risk review, and culture-before-antibiotics, biopsy, "
                "or do-not-delay empiric antibiotics for unstable or neurologic "
                "compromise planning"
            ),
        ),
        DomainSafetyGate(
            name="septic_arthritis_time_critical_actions",
            applies=_requires_septic_arthritis_safety_check,
            field_name="time_critical_actions",
            validator=_has_septic_arthritis_time_critical_actions,
            issue=(
                "septic arthritis time-critical actions must include urgent "
                "arthrocentesis, joint aspiration, tap, synovial fluid, or "
                "synovial aspiration, synovial WBC, leukocyte, cell count, "
                "Gram stain, culture, microscopy, or crystal studies, blood "
                "cultures, CRP, ESR, leukocytosis, or inflammatory marker "
                "assessment, empiric antibiotics such as vancomycin or "
                "ceftriaxone, and orthopedic, arthroscopy, irrigation, "
                "drainage, surgical washout, or washout escalation"
            ),
        ),
        DomainSafetyGate(
            name="septic_arthritis_treatment_safety",
            applies=_requires_septic_arthritis_safety_check,
            field_name="contraindication_checks",
            validator=_has_septic_arthritis_treatment_safety_check,
            issue=(
                "septic arthritis safety checks must include gout, pseudogout, "
                "crystals, not-exclude, crystals-do-not-exclude, or still-possible "
                "review, antibiotic timing with aspiration or blood cultures before "
                "antibiotics while not delaying empiric antibiotics in sepsis or "
                "unstable patients, pathogen risk review for MRSA, Staphylococcus, "
                "gonococcal, Gram-negative, IVDU, immunocompromised, vancomycin, "
                "or ceftriaxone coverage, and complication or source review for "
                "bacteremia, endocarditis, osteomyelitis, prosthetic joint, sepsis, "
                "source, or surgery"
            ),
        ),
        DomainSafetyGate(
            name="upper_gi_bleed_time_critical_actions",
            applies=_requires_upper_gi_bleed_safety_check,
            field_name="time_critical_actions",
            validator=_has_upper_gi_bleed_time_critical_actions,
            issue=(
                "upper GI bleeding time-critical actions must include hemodynamic "
                "resuscitation with large-bore IV access, shock, or massive "
                "transfusion planning, CBC, hemoglobin, INR, type and screen, "
                "crossmatch, PRBC, restrictive transfusion, or transfusion "
                "assessment, early endoscopy, EGD, endoscopic hemostasis, "
                "gastroenterology, GI consult, or within-24-hours endoscopy "
                "planning, and PPI, proton pump inhibitor, octreotide, "
                "terlipressin, somatostatin, vasoactive therapy, ceftriaxone, "
                "or antibiotic planning for ulcer or suspected variceal bleeding"
            ),
        ),
        DomainSafetyGate(
            name="upper_gi_bleed_treatment_safety",
            applies=_requires_upper_gi_bleed_safety_check,
            field_name="contraindication_checks",
            validator=_has_upper_gi_bleed_treatment_safety_check,
            issue=(
                "upper GI bleeding safety checks must include airway, aspiration, "
                "active hematemesis, vomiting blood, intubation, or altered "
                "mental status planning, anticoagulant, antiplatelet, warfarin, "
                "DOAC, INR, platelet, coagulopathy, or reversal review, variceal, "
                "cirrhosis, portal hypertension, TIPS, balloon tamponade, stent, "
                "or rescue therapy review, and rebleeding, repeat endoscopy, ICU, "
                "unstable, shock, or risk-stratification disposition monitoring"
            ),
        ),
        DomainSafetyGate(
            name="acute_cholecystitis_time_critical_actions",
            applies=_requires_acute_cholecystitis_safety_check,
            field_name="time_critical_actions",
            validator=_has_acute_cholecystitis_time_critical_actions,
            issue=(
                "acute cholecystitis time-critical actions must include Tokyo, "
                "severity, grade, organ dysfunction, Charlson, CCI, ASA, or "
                "ASA-PS risk assessment, broad-spectrum antibiotics plus blood "
                "culture, bile culture, ceftriaxone, piperacillin, or culture "
                "planning, RUQ ultrasound, CT, HIDA scan, sonographic Murphy, "
                "gallbladder wall, or pericholecystic imaging assessment, and "
                "early laparoscopic cholecystectomy, Lap-C, cholecystectomy, "
                "gallbladder drainage, cholecystostomy, PTGBD, percutaneous, or "
                "drainage source-control planning"
            ),
        ),
        DomainSafetyGate(
            name="acute_cholecystitis_treatment_safety",
            applies=_requires_acute_cholecystitis_safety_check,
            field_name="contraindication_checks",
            validator=_has_acute_cholecystitis_treatment_safety_check,
            issue=(
                "acute cholecystitis safety checks must include high-risk "
                "surgery or drainage planning for ASA-PS, Charlson, high risk, "
                "percutaneous gallbladder drainage, PTGBD, or cholecystostomy, "
                "complication review for emphysematous, gangrenous, perforation, "
                "peritonitis, sepsis, or shock, bile-duct injury prevention with "
                "critical view of safety, CVS, bail-out, subtotal cholecystectomy, "
                "conversion, bile leak, or common bile duct review, and "
                "differential review for cholangitis, choledocholithiasis, "
                "gallstone pancreatitis, pancreatitis, hepatitis, peptic ulcer, "
                "or myocardial infarction"
            ),
        ),
        DomainSafetyGate(
            name="acute_cholangitis_time_critical_actions",
            applies=_requires_acute_cholangitis_safety_check,
            field_name="time_critical_actions",
            validator=_has_acute_cholangitis_time_critical_actions,
            issue=(
                "acute cholangitis time-critical actions must include immediate "
                "broad-spectrum antibiotics and supportive care, blood culture, "
                "bile culture, WBC, CRP, bilirubin, LFT, or liver function "
                "assessment, ultrasound, CT, MRCP, biliary dilation, common "
                "bile duct, stone, stricture, or obstruction imaging, ERCP, "
                "biliary drainage, biliary decompression, stent, PTBD, "
                "nasobiliary, or percutaneous transhepatic drainage planning, "
                "and sepsis, shock, fluid, vasopressor, respiratory, circulatory, "
                "organ-support, or ICU escalation"
            ),
        ),
        DomainSafetyGate(
            name="acute_cholangitis_treatment_safety",
            applies=_requires_acute_cholangitis_safety_check,
            field_name="contraindication_checks",
            validator=_has_acute_cholangitis_treatment_safety_check,
            issue=(
                "acute cholangitis safety checks must include Tokyo severity or "
                "organ dysfunction review for shock, disturbance of consciousness, "
                "acute dyspnea, renal dysfunction, DIC, or severe disease, early "
                "or emergency biliary drainage timing with do-not-delay, within-24 "
                "or within-48-hours, transfer, or advanced-center planning, ERCP "
                "procedure-risk review for anticoagulant, coagulopathy, "
                "sphincterotomy, pancreatitis, failed ERCP, altered anatomy, "
                "PTBD, or percutaneous drainage alternatives, and source-control "
                "or differential review for cholecystitis, pancreatitis, gallstone "
                "pancreatitis, malignant obstruction, stone, or bile culture"
            ),
        ),
        DomainSafetyGate(
            name="acute_pancreatitis_time_critical_actions",
            applies=_requires_acute_pancreatitis_safety_check,
            field_name="time_critical_actions",
            validator=_has_acute_pancreatitis_time_critical_actions,
            issue=(
                "acute pancreatitis time-critical actions must include early "
                "goal-directed crystalloid or lactated Ringer fluid resuscitation, "
                "analgesia, antiemetic, nausea, opioid, or pain-control support, "
                "lipase, ALT, LFT, ultrasound, gallstone, triglyceride, or calcium "
                "etiology assessment, and BUN, hematocrit, severity, oxygen, shock, "
                "renal, organ-failure, or ICU monitoring"
            ),
        ),
        DomainSafetyGate(
            name="acute_pancreatitis_treatment_safety",
            applies=_requires_acute_pancreatitis_safety_check,
            field_name="contraindication_checks",
            validator=_has_acute_pancreatitis_treatment_safety_check,
            issue=(
                "acute pancreatitis safety checks must include ERCP or biliary "
                "obstruction review for cholangitis, jaundice, no-cholangitis, "
                "or without-cholangitis scenarios, avoidance of prophylactic "
                "antibiotics in sterile necrosis with antibiotic use reserved "
                "for infected necrosis or extrapancreatic infection, oral or "
                "enteral feeding, NG tube, TPN, parenteral, or nutrition planning, "
                "and infected necrosis, walled-off necrosis, delayed drainage, "
                "4-week, or step-up procedure timing review"
            ),
        ),
        DomainSafetyGate(
            name="small_bowel_obstruction_time_critical_actions",
            applies=_requires_small_bowel_obstruction_safety_check,
            field_name="time_critical_actions",
            validator=_has_small_bowel_obstruction_time_critical_actions,
            issue=(
                "small bowel obstruction time-critical actions must include bowel "
                "rest, NPO, nil per os, NG tube, nasogastric suction, or "
                "decompression planning, IV crystalloid, fluid, dehydration, "
                "electrolyte, potassium, or urine output resuscitation, CT "
                "abdomen, transition point, closed-loop, free fluid, ischemia, "
                "or strangulation assessment, and urgent surgery, surgeon, "
                "surgical consult, operative, exploration, or laparotomy escalation"
            ),
        ),
        DomainSafetyGate(
            name="small_bowel_obstruction_treatment_safety",
            applies=_requires_small_bowel_obstruction_safety_check,
            field_name="contraindication_checks",
            validator=_has_small_bowel_obstruction_treatment_safety_check,
            issue=(
                "small bowel obstruction safety checks must include strangulation "
                "or ischemia red-flag review for peritonitis, continuous pain, "
                "fever, leukocytosis, acidosis, lactate, or closed-loop "
                "obstruction, nonoperative management limits with serial exams, "
                "water-soluble contrast or Gastrografin, complete obstruction, "
                "failure to resolve, conservative management, or 72-hour "
                "reassessment, perforation, free air, infarction, gangrene, "
                "sepsis, broad-spectrum antibiotics, or antibiotic planning, "
                "and aspiration or etiology review for vomiting, adhesions, "
                "hernia, incarcerated hernia, volvulus, tumor, or malignancy"
            ),
        ),
        DomainSafetyGate(
            name="acute_appendicitis_time_critical_actions",
            applies=_requires_acute_appendicitis_safety_check,
            field_name="time_critical_actions",
            validator=_has_acute_appendicitis_time_critical_actions,
            issue=(
                "acute appendicitis time-critical actions must include clinical "
                "risk score, Alvarado, AIR score, Adult Appendicitis Score, "
                "ultrasound, CT, MRI, or imaging assessment, urgent surgery, "
                "surgeon, surgical consult, appendectomy, appendicectomy, "
                "laparoscopy, or operative pathway, perioperative, preoperative, "
                "broad-spectrum, ceftriaxone, metronidazole, cefoxitin, "
                "piperacillin, or antibiotic planning, and complicated "
                "appendicitis assessment for perforation, peritonitis, abscess, "
                "phlegmon, drainage, sepsis, or source control"
            ),
        ),
        DomainSafetyGate(
            name="acute_appendicitis_treatment_safety",
            applies=_requires_acute_appendicitis_safety_check,
            field_name="contraindication_checks",
            validator=_has_acute_appendicitis_treatment_safety_check,
            issue=(
                "acute appendicitis safety checks must include nonoperative "
                "selection limits for uncomplicated disease, appendicolith, "
                "antibiotics-first, selected patients, shared decision, or "
                "recurrence risk, complicated appendicitis source-control or "
                "antibiotic safety for abscess drainage, percutaneous drainage, "
                "postoperative antibiotic short course, 2-3 days, or source "
                "control, special population or differential review for "
                "pregnancy, pediatric, older, immunocompromised, gynecologic, "
                "ectopic, terminal ileitis, or renal colic scenarios, and "
                "peritonitis, perforation, rupture, sepsis, shock, diffuse, or "
                "generalized peritonitis escalation"
            ),
        ),
        DomainSafetyGate(
            name="acute_mesenteric_ischemia_time_critical_actions",
            applies=_requires_acute_mesenteric_ischemia_safety_check,
            field_name="time_critical_actions",
            validator=_has_acute_mesenteric_ischemia_time_critical_actions,
            issue=(
                "acute mesenteric ischemia time-critical actions must include "
                "CTA or CT angiography, resuscitation with lactate, acidosis, "
                "shock, or fluid monitoring, early broad-spectrum antibiotics, "
                "and urgent surgery, vascular surgery, endovascular therapy, "
                "laparotomy, embolectomy, revascularization, or bowel-resection "
                "escalation"
            ),
        ),
        DomainSafetyGate(
            name="acute_mesenteric_ischemia_treatment_safety",
            applies=_requires_acute_mesenteric_ischemia_safety_check,
            field_name="contraindication_checks",
            validator=_has_acute_mesenteric_ischemia_treatment_safety_check,
            issue=(
                "acute mesenteric ischemia safety checks must include heparin "
                "or anticoagulation bleeding contraindication review, bowel "
                "viability, necrosis, peritonitis, damage-control, second-look, "
                "or short-bowel planning, embolic, thrombotic, SMA, venous, "
                "atrial-fibrillation, low-flow, or nonocclusive cause review, "
                "and lactate limitation or do-not-delay CTA/intervention safety"
            ),
        ),
        DomainSafetyGate(
            name="necrotizing_soft_tissue_infection_time_critical_actions",
            applies=_requires_necrotizing_soft_tissue_infection_safety_check,
            field_name="time_critical_actions",
            validator=_has_necrotizing_soft_tissue_infection_time_critical_actions,
            issue=(
                "necrotizing soft tissue infection time-critical actions must "
                "include urgent surgical exploration, operative debridement, "
                "fasciotomy, or surgical consultation, broad-spectrum empiric "
                "antibiotics, sepsis, shock, lactate, ICU, vasopressor, or fluid "
                "resuscitation, and explicit do-not-delay source-control or "
                "immediate time-critical management"
            ),
        ),
        DomainSafetyGate(
            name="necrotizing_soft_tissue_infection_treatment_safety",
            applies=_requires_necrotizing_soft_tissue_infection_safety_check,
            field_name="contraindication_checks",
            validator=_has_necrotizing_soft_tissue_infection_treatment_safety_check,
            issue=(
                "necrotizing soft tissue infection safety checks must include "
                "clindamycin, linezolid, group A strep, clostridial gas gangrene, "
                "or toxin-suppression planning, repeat, second-look, 24-to-48-hour "
                "debridement or source-control reassessment, LRINEC, imaging, "
                "or diagnostic testing not delaying surgical exploration, and "
                "shock, renal injury, coagulopathy, organ failure, amputation, "
                "diabetes, or immunocompromised risk monitoring"
            ),
        ),
        DomainSafetyGate(
            name="ruptured_aaa_time_critical_actions",
            applies=_requires_ruptured_aaa_safety_check,
            field_name="time_critical_actions",
            validator=_has_ruptured_aaa_time_critical_actions,
            issue=(
                "ruptured or symptomatic abdominal aortic aneurysm time-critical "
                "actions must include immediate vascular surgery, EVAR, open "
                "repair, or operative repair escalation, permissive hypotension "
                "or controlled restrictive resuscitation planning, blood product, "
                "crossmatch, large-bore access, or massive transfusion preparation, "
                "and bedside ultrasound, CTA, or imaging-not-to-delay strategy"
            ),
        ),
        DomainSafetyGate(
            name="ruptured_aaa_treatment_safety",
            applies=_requires_ruptured_aaa_safety_check,
            field_name="contraindication_checks",
            validator=_has_ruptured_aaa_treatment_safety_check,
            issue=(
                "ruptured or symptomatic abdominal aortic aneurysm safety checks "
                "must include unstable-patient transfer, imaging, or repair-not-to-delay "
                "planning, bleeding, hemorrhage, anticoagulation, antiplatelet, "
                "or thrombolysis avoidance review, and shock, coagulopathy, "
                "hypothermia, renal injury, cardiac arrest, or abdominal compartment "
                "complication monitoring"
            ),
        ),
        DomainSafetyGate(
            name="subarachnoid_hemorrhage_time_critical_actions",
            applies=_requires_subarachnoid_hemorrhage_safety_check,
            field_name="time_critical_actions",
            validator=_has_subarachnoid_hemorrhage_time_critical_actions,
            issue=(
                "subarachnoid hemorrhage time-critical actions must include "
                "urgent non-contrast head CT, lumbar puncture, CTA, or "
                "xanthochromia pathway when CT is negative or delayed, "
                "neurosurgery, neurocritical care, or specialist transfer "
                "escalation, and blood pressure control or nimodipine planning"
            ),
        ),
        DomainSafetyGate(
            name="subarachnoid_hemorrhage_treatment_safety",
            applies=_requires_subarachnoid_hemorrhage_safety_check,
            field_name="contraindication_checks",
            validator=_has_subarachnoid_hemorrhage_treatment_safety_check,
            issue=(
                "subarachnoid hemorrhage safety checks must include anticoagulant, "
                "antiplatelet, INR, platelet, coagulopathy, or reversal review, "
                "rebleeding or unsecured-aneurysm blood-pressure safeguards, "
                "and hydrocephalus, vasospasm, delayed cerebral ischemia, seizure, "
                "EVD, ICU, or neurocritical complication monitoring"
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
            name="hyperkalemia_time_critical_actions",
            applies=_requires_hyperkalemia_safety_check,
            field_name="time_critical_actions",
            validator=_has_hyperkalemia_time_critical_actions,
            issue=(
                "severe hyperkalemia time-critical actions must include IV calcium "
                "or cardiac membrane stabilization, potassium-shifting therapy, "
                "and potassium removal or dialysis planning"
            ),
        ),
        DomainSafetyGate(
            name="hyperkalemia_treatment_safety",
            applies=_requires_hyperkalemia_safety_check,
            field_name="contraindication_checks",
            validator=_has_hyperkalemia_treatment_safety_check,
            issue=(
                "severe hyperkalemia safety checks must include ECG or telemetry "
                "with repeat potassium monitoring, hypoglycemia or glucose "
                "monitoring after insulin, and renal or medication recurrence review"
            ),
        ),
        DomainSafetyGate(
            name="status_epilepticus_time_critical_actions",
            applies=_requires_status_epilepticus_safety_check,
            field_name="time_critical_actions",
            validator=_has_status_epilepticus_time_critical_actions,
            issue=(
                "status epilepticus time-critical actions must include airway or "
                "oxygen support, benzodiazepine treatment, second-line antiseizure "
                "loading, and refractory seizure escalation"
            ),
        ),
        DomainSafetyGate(
            name="status_epilepticus_treatment_safety",
            applies=_requires_status_epilepticus_safety_check,
            field_name="contraindication_checks",
            validator=_has_status_epilepticus_treatment_safety_check,
            issue=(
                "status epilepticus safety checks must include glucose or thiamine "
                "assessment, respiratory depression or aspiration safeguards, and "
                "second-line antiseizure dosing or contraindication review"
            ),
        ),
        DomainSafetyGate(
            name="adrenal_crisis_time_critical_actions",
            applies=_requires_adrenal_crisis_safety_check,
            field_name="time_critical_actions",
            validator=_has_adrenal_crisis_time_critical_actions,
            issue=(
                "adrenal crisis time-critical actions must include immediate "
                "hydrocortisone or stress-dose steroid, isotonic saline or "
                "dextrose resuscitation, and glucose, electrolyte, or hemodynamic "
                "monitoring"
            ),
        ),
        DomainSafetyGate(
            name="adrenal_crisis_treatment_safety",
            applies=_requires_adrenal_crisis_safety_check,
            field_name="contraindication_checks",
            validator=_has_adrenal_crisis_treatment_safety_check,
            issue=(
                "adrenal crisis safety checks must include not delaying "
                "hydrocortisone for cortisol testing, glucose and electrolyte "
                "monitoring, and precipitant, infection, or missed-steroid review"
            ),
        ),
        DomainSafetyGate(
            name="acetaminophen_toxicity_time_critical_actions",
            applies=_requires_acetaminophen_toxicity_safety_check,
            field_name="time_critical_actions",
            validator=_has_acetaminophen_toxicity_time_critical_actions,
            issue=(
                "acetaminophen toxicity time-critical actions must include a "
                "timed acetaminophen level with Rumack-Matthew nomogram planning, "
                "N-acetylcysteine treatment planning, and hepatic injury or "
                "toxicology monitoring"
            ),
        ),
        DomainSafetyGate(
            name="acetaminophen_toxicity_treatment_safety",
            applies=_requires_acetaminophen_toxicity_safety_check,
            field_name="contraindication_checks",
            validator=_has_acetaminophen_toxicity_treatment_safety_check,
            issue=(
                "acetaminophen toxicity safety checks must include ingestion timing "
                "or formulation limits for nomogram use, N-acetylcysteine dosing "
                "or infusion safety, and hepatic failure or transplant-risk monitoring"
            ),
        ),
        DomainSafetyGate(
            name="toxic_alcohol_time_critical_actions",
            applies=_requires_toxic_alcohol_safety_check,
            field_name="time_critical_actions",
            validator=_has_toxic_alcohol_time_critical_actions,
            issue=(
                "toxic alcohol time-critical actions must include anion gap, "
                "osmolal gap, osmolar gap, serum osmolality, methanol, ethylene "
                "glycol, or toxic alcohol level assessment, fomepizole or ethanol "
                "alcohol-dehydrogenase blockade, poison center, toxicologist, "
                "nephrology, hemodialysis, dialysis, or extracorporeal escalation, "
                "and acidosis, blood gas, pH, or bicarbonate support planning"
            ),
        ),
        DomainSafetyGate(
            name="toxic_alcohol_treatment_safety",
            applies=_requires_toxic_alcohol_safety_check,
            field_name="contraindication_checks",
            validator=_has_toxic_alcohol_treatment_safety_check,
            issue=(
                "toxic alcohol safety checks must include hemodialysis indication "
                "review for severe acidosis, anion gap, coma, seizure, visual "
                "symptoms, renal failure, kidney failure, or high-risk level, "
                "vision, optic, renal, kidney, urine, hypocalcemia, or calcium "
                "oxalate organ-injury monitoring, and ethanol, isopropanol, "
                "salicylate, ketoacidosis, lactic acidosis, late presentation, "
                "or co-ingestion differential review"
            ),
        ),
        DomainSafetyGate(
            name="salicylate_toxicity_time_critical_actions",
            applies=_requires_salicylate_toxicity_safety_check,
            field_name="time_critical_actions",
            validator=_has_salicylate_toxicity_time_critical_actions,
            issue=(
                "salicylate toxicity time-critical actions must include serial "
                "salicylate levels with anion gap, blood gas, ABG, VBG, or "
                "electrolyte monitoring, activated charcoal or multidose charcoal "
                "decontamination planning, sodium bicarbonate, urine alkalinization, "
                "alkaline diuresis, potassium, or urine pH planning, and poison "
                "center, toxicologist, nephrology, hemodialysis, or dialysis escalation"
            ),
        ),
        DomainSafetyGate(
            name="salicylate_toxicity_treatment_safety",
            applies=_requires_salicylate_toxicity_safety_check,
            field_name="contraindication_checks",
            validator=_has_salicylate_toxicity_treatment_safety_check,
            issue=(
                "salicylate toxicity safety checks must include hemodialysis "
                "indication review for acidemia, severe acidosis, altered mental "
                "status, seizure, renal failure, kidney failure, pulmonary edema, "
                "or very high salicylate level, intubation or mechanical ventilation "
                "pH-preservation planning with hyperventilation or bicarbonate "
                "safeguards, and potassium, hypokalemia, glucose, hypoglycemia, "
                "temperature, pulmonary edema, or cerebral edema monitoring"
            ),
        ),
        DomainSafetyGate(
            name="carbon_monoxide_poisoning_time_critical_actions",
            applies=_requires_carbon_monoxide_poisoning_safety_check,
            field_name="time_critical_actions",
            validator=_has_carbon_monoxide_poisoning_time_critical_actions,
            issue=(
                "carbon monoxide poisoning time-critical actions must include "
                "source removal or 100% high-flow oxygen by non-rebreather, "
                "carboxyhemoglobin, COHb, or co-oximetry diagnostic confirmation, "
                "hyperbaric oxygen, HBOT, poison center, toxicologist, or "
                "specialty escalation planning, and cardiac, ECG, troponin, "
                "lactate, neurologic, altered mental status, syncope, or seizure "
                "assessment"
            ),
        ),
        DomainSafetyGate(
            name="carbon_monoxide_poisoning_treatment_safety",
            applies=_requires_carbon_monoxide_poisoning_safety_check,
            field_name="contraindication_checks",
            validator=_has_carbon_monoxide_poisoning_treatment_safety_check,
            issue=(
                "carbon monoxide poisoning safety checks must include pulse "
                "oximetry or SpO2 false-normal limitation review, hyperbaric "
                "oxygen criteria review for pregnancy, neurologic symptoms, "
                "loss of consciousness, syncope, acidosis, cardiac ischemia, "
                "or high carboxyhemoglobin, cardiac, ECG, troponin, lactate, "
                "metabolic acidosis, myocardial, delayed neurologic, or "
                "neurocognitive complication monitoring, and smoke inhalation, "
                "cyanide, hydroxocobalamin, burn, fire, or lactate co-toxicity "
                "assessment"
            ),
        ),
        DomainSafetyGate(
            name="cyanide_poisoning_time_critical_actions",
            applies=_requires_cyanide_poisoning_safety_check,
            field_name="time_critical_actions",
            validator=_has_cyanide_poisoning_time_critical_actions,
            issue=(
                "cyanide poisoning time-critical actions must include source "
                "removal or 100% oxygen with respiratory or circulatory support, "
                "hydroxocobalamin, Cyanokit, sodium thiosulfate, or thiosulfate "
                "antidote planning, lactate, blood gas, ABG, VBG, pH, anion gap, "
                "or metabolic acidosis assessment, and poison center, toxicologist, "
                "ICU, or burn center escalation"
            ),
        ),
        DomainSafetyGate(
            name="cyanide_poisoning_treatment_safety",
            applies=_requires_cyanide_poisoning_safety_check,
            field_name="contraindication_checks",
            validator=_has_cyanide_poisoning_treatment_safety_check,
            issue=(
                "cyanide poisoning safety checks must include empiric antidote "
                "or do-not-wait cyanide-level planning, smoke inhalation, carbon "
                "monoxide, COHb, carboxyhemoglobin, or nitrite-avoidance review, "
                "shock, hypotension, cardiac arrest, coma, seizure, syncope, or "
                "altered mental status monitoring, and hydroxocobalamin blood "
                "pressure, red urine, chromaturia, lab-interference, or dialysis "
                "interference safety"
            ),
        ),
        DomainSafetyGate(
            name="opioid_toxicity_time_critical_actions",
            applies=_requires_opioid_toxicity_safety_check,
            field_name="time_critical_actions",
            validator=_has_opioid_toxicity_time_critical_actions,
            issue=(
                "opioid toxicity time-critical actions must include airway or "
                "ventilatory support, naloxone reversal, and recurrent respiratory "
                "depression monitoring or repeat-dose planning"
            ),
        ),
        DomainSafetyGate(
            name="opioid_toxicity_treatment_safety",
            applies=_requires_opioid_toxicity_safety_check,
            field_name="contraindication_checks",
            validator=_has_opioid_toxicity_treatment_safety_check,
            issue=(
                "opioid toxicity safety checks must include long-acting opioid or "
                "renarcotization observation, co-ingestion or alternate-cause "
                "assessment, and naloxone titration, withdrawal, aspiration, or "
                "pulmonary-edema safeguards"
            ),
        ),
        DomainSafetyGate(
            name="severe_asthma_time_critical_actions",
            applies=_requires_severe_asthma_safety_check,
            field_name="time_critical_actions",
            validator=_has_severe_asthma_time_critical_actions,
            issue=(
                "severe asthma time-critical actions must include oxygen or "
                "ventilatory support, repeated or continuous SABA plus ipratropium, "
                "systemic corticosteroids, and magnesium or ICU/intubation escalation "
                "for poor response"
            ),
        ),
        DomainSafetyGate(
            name="severe_asthma_treatment_safety",
            applies=_requires_severe_asthma_safety_check,
            field_name="contraindication_checks",
            validator=_has_severe_asthma_treatment_safety_check,
            issue=(
                "severe asthma safety checks must include serial severity or "
                "response monitoring, impending respiratory failure or ventilation "
                "risk review, and beta-agonist adverse-effect, electrolyte, or "
                "trigger reassessment"
            ),
        ),
        DomainSafetyGate(
            name="severe_cap_time_critical_actions",
            applies=_requires_severe_cap_safety_check,
            field_name="time_critical_actions",
            validator=_has_severe_cap_time_critical_actions,
            issue=(
                "severe community-acquired pneumonia time-critical actions must "
                "include oxygen, airway, HFNC, ventilation, intubation, "
                "hypoxemia, or respiratory-failure support, chest x-ray, chest "
                "radiograph, blood culture, sputum or respiratory culture, "
                "Legionella, urinary antigen, or severe-CAP diagnostic testing, "
                "empiric antibiotic therapy with beta-lactam, ceftriaxone, "
                "cefotaxime, ceftaroline, macrolide, azithromycin, levofloxacin, "
                "or moxifloxacin coverage, and sepsis, septic shock, lactate, "
                "vasopressor, ICU, or shock escalation"
            ),
        ),
        DomainSafetyGate(
            name="severe_cap_treatment_safety",
            applies=_requires_severe_cap_safety_check,
            field_name="contraindication_checks",
            validator=_has_severe_cap_treatment_safety_check,
            issue=(
                "severe community-acquired pneumonia safety checks must include "
                "MRSA or Pseudomonas risk-factor review for prior respiratory "
                "isolation, recent hospitalization or IV antibiotics within "
                "90 days, vancomycin coverage, and de-escalation, severity or "
                "disposition review with PSI, CURB-65, major/minor criteria, "
                "shock, hypotension, or ICU need, parapneumonic effusion, "
                "empyema, loculated effusion, thoracentesis, or drainage review, "
                "and viral, influenza, COVID, aspiration, lung abscess, or "
                "pulmonary embolism differential assessment"
            ),
        ),
        DomainSafetyGate(
            name="copd_exacerbation_time_critical_actions",
            applies=_requires_copd_exacerbation_safety_check,
            field_name="time_critical_actions",
            validator=_has_copd_exacerbation_time_critical_actions,
            issue=(
                "COPD exacerbation time-critical actions must include controlled "
                "oxygen targeting 88-92%, short-acting bronchodilators, systemic "
                "corticosteroids, antibiotic or purulent-infection criteria, and "
                "NIV or ventilatory escalation for hypercapnic respiratory failure"
            ),
        ),
        DomainSafetyGate(
            name="copd_exacerbation_treatment_safety",
            applies=_requires_copd_exacerbation_safety_check,
            field_name="contraindication_checks",
            validator=_has_copd_exacerbation_treatment_safety_check,
            issue=(
                "COPD exacerbation safety checks must include oxygen-induced "
                "hypercapnia or ABG monitoring, NIV/intubation failure criteria, "
                "cardiopulmonary differential diagnosis review, and bronchodilator "
                "or steroid adverse-effect monitoring"
            ),
        ),
        DomainSafetyGate(
            name="acute_heart_failure_time_critical_actions",
            applies=_requires_acute_heart_failure_safety_check,
            field_name="time_critical_actions",
            validator=_has_acute_heart_failure_time_critical_actions,
            issue=(
                "acute heart failure time-critical actions must include oxygen or "
                "noninvasive ventilation for pulmonary edema, IV loop diuretic "
                "decongestion, blood-pressure-guided vasodilator or nitrate "
                "planning, and shock or respiratory-failure escalation"
            ),
        ),
        DomainSafetyGate(
            name="acute_heart_failure_treatment_safety",
            applies=_requires_acute_heart_failure_safety_check,
            field_name="contraindication_checks",
            validator=_has_acute_heart_failure_treatment_safety_check,
            issue=(
                "acute heart failure safety checks must include blood pressure or "
                "vasodilator contraindication review, renal and electrolyte "
                "monitoring during diuresis, trigger or cardiopulmonary differential "
                "review, and shock or respiratory-failure monitoring"
            ),
        ),
        DomainSafetyGate(
            name="cardiac_tamponade_time_critical_actions",
            applies=_requires_cardiac_tamponade_safety_check,
            field_name="time_critical_actions",
            validator=_has_cardiac_tamponade_time_critical_actions,
            issue=(
                "cardiac tamponade time-critical actions must include bedside "
                "echo, cardiac POCUS, or ultrasound assessment, immediate "
                "pericardiocentesis, pericardial drainage, pericardial window, "
                "or pericardiotomy planning, cardiology, cardiothoracic, thoracic, "
                "trauma, or emergency surgery escalation, and hemodynamic support "
                "with fluids, blood pressure, vasopressor, hypotension, or shock "
                "management"
            ),
        ),
        DomainSafetyGate(
            name="cardiac_tamponade_treatment_safety",
            applies=_requires_cardiac_tamponade_safety_check,
            field_name="contraindication_checks",
            validator=_has_cardiac_tamponade_treatment_safety_check,
            issue=(
                "cardiac tamponade safety checks must include unstable-patient "
                "do-not-delay or immediate-drainage planning, anticoagulant, "
                "thrombolysis, bleeding, coagulopathy, INR, platelet, or reversal "
                "review, and trauma, iatrogenic injury, myocardial infarction or "
                "rupture, aortic dissection, malignancy, uremia, or renal failure "
                "cause assessment"
            ),
        ),
        DomainSafetyGate(
            name="tension_pneumothorax_time_critical_actions",
            applies=_requires_tension_pneumothorax_safety_check,
            field_name="time_critical_actions",
            validator=_has_tension_pneumothorax_time_critical_actions,
            issue=(
                "tension pneumothorax time-critical actions must include immediate "
                "needle or finger decompression, definitive chest tube or tube "
                "thoracostomy, airway or oxygen support, and post-decompression "
                "reassessment"
            ),
        ),
        DomainSafetyGate(
            name="tension_pneumothorax_treatment_safety",
            applies=_requires_tension_pneumothorax_safety_check,
            field_name="contraindication_checks",
            validator=_has_tension_pneumothorax_treatment_safety_check,
            issue=(
                "tension pneumothorax safety checks must include not delaying "
                "decompression for imaging, decompression site or technique safety, "
                "recurrence or chest-tube failure monitoring, and obstructive-shock "
                "differential review"
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
        DomainSafetyGate(
            name="aortic_dissection_time_critical_actions",
            applies=_requires_aortic_dissection_safety_check,
            field_name="time_critical_actions",
            validator=_has_aortic_dissection_time_critical_actions,
            issue=(
                "aortic dissection time-critical actions must include definitive "
                "aortic imaging, anti-impulse blood pressure or heart-rate control, "
                "and cardiothoracic, vascular, or aortic-team surgical escalation"
            ),
        ),
        DomainSafetyGate(
            name="aortic_dissection_treatment_safety",
            applies=_requires_aortic_dissection_safety_check,
            field_name="contraindication_checks",
            validator=_has_aortic_dissection_treatment_safety_check,
            issue=(
                "aortic dissection safety checks must include antithrombotic or "
                "thrombolysis avoidance, beta-blocker-before-vasodilator impulse "
                "control safety, and malperfusion, rupture, tamponade, or aortic "
                "regurgitation complications"
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


def _requires_anaphylaxis_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in ANAPHYLAXIS_CONTEXT_TERMS
    )


def _has_anaphylaxis_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_epinephrine = any(
        _contains_safety_term(normalized_actions, term)
        for term in ANAPHYLAXIS_EPINEPHRINE_ACTION_TERMS
    )
    has_airway = any(
        _contains_safety_term(normalized_actions, term)
        for term in ANAPHYLAXIS_AIRWAY_ACTION_TERMS
    )
    has_shock_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in ANAPHYLAXIS_SHOCK_ACTION_TERMS
    )
    return has_epinephrine and has_airway and has_shock_escalation


def _has_anaphylaxis_observation_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_trigger_review = any(
        _contains_safety_term(normalized_checks, term)
        for term in ANAPHYLAXIS_TRIGGER_SAFETY_TERMS
    )
    has_observation = any(
        _contains_safety_term(normalized_checks, term)
        for term in ANAPHYLAXIS_OBSERVATION_SAFETY_TERMS
    )
    return has_trigger_review and has_observation


def _requires_gi_bleed_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in GI_BLEED_CONTEXT_TERMS
    )


def _has_gi_bleed_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_resuscitation = any(
        _contains_safety_term(normalized_actions, term)
        for term in GI_BLEED_RESUSCITATION_ACTION_TERMS
    )
    has_blood_prep = any(
        _contains_safety_term(normalized_actions, term)
        for term in GI_BLEED_BLOOD_PREP_ACTION_TERMS
    )
    has_source_control = any(
        _contains_safety_term(normalized_actions, term)
        for term in GI_BLEED_SOURCE_CONTROL_ACTION_TERMS
    )
    return has_resuscitation and has_blood_prep and has_source_control


def _has_gi_bleed_transfusion_reversal_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_reversal_review = any(
        _contains_safety_term(normalized_checks, term)
        for term in GI_BLEED_REVERSAL_SAFETY_TERMS
    )
    has_transfusion_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in GI_BLEED_TRANSFUSION_SAFETY_TERMS
    )
    return has_reversal_review and has_transfusion_safety


def _requires_cns_infection_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in CNS_INFECTION_CONTEXT_TERMS
    )


def _has_cns_infection_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_cultures = any(
        _contains_safety_term(normalized_actions, term)
        for term in CNS_INFECTION_CULTURE_ACTION_TERMS
    )
    has_antibiotics = any(
        _contains_safety_term(normalized_actions, term)
        for term in CNS_INFECTION_ANTIBIOTIC_ACTION_TERMS
    )
    has_lp_or_ct_pathway = any(
        _contains_safety_term(normalized_actions, term)
        for term in CNS_INFECTION_LP_CT_ACTION_TERMS
    )
    has_steroid_timing = any(
        _contains_safety_term(normalized_actions, term)
        for term in CNS_INFECTION_STEROID_ACTION_TERMS
    )
    return has_cultures and has_antibiotics and has_lp_or_ct_pathway and has_steroid_timing


def _has_cns_infection_lp_steroid_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_antimicrobial_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CNS_INFECTION_ANTIMICROBIAL_SAFETY_TERMS
    )
    has_lp_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CNS_INFECTION_LP_SAFETY_TERMS
    )
    has_steroid_timing = any(
        _contains_safety_term(normalized_checks, term)
        for term in CNS_INFECTION_STEROID_SAFETY_TERMS
    )
    return has_antimicrobial_safety and has_lp_safety and has_steroid_timing


def _requires_ectopic_pregnancy_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in ECTOPIC_PREGNANCY_CONTEXT_TERMS
    )


def _has_ectopic_pregnancy_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_hcg = any(
        _contains_safety_term(normalized_actions, term)
        for term in ECTOPIC_PREGNANCY_HCG_ACTION_TERMS
    )
    has_ultrasound = any(
        _contains_safety_term(normalized_actions, term)
        for term in ECTOPIC_PREGNANCY_ULTRASOUND_ACTION_TERMS
    )
    has_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in ECTOPIC_PREGNANCY_ESCALATION_ACTION_TERMS
    )
    return has_hcg and has_ultrasound and has_escalation


def _has_ectopic_pregnancy_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_rh_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ECTOPIC_PREGNANCY_RH_SAFETY_TERMS
    )
    has_mtx_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ECTOPIC_PREGNANCY_MTX_SAFETY_TERMS
    )
    has_hemodynamic_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ECTOPIC_PREGNANCY_HEMODYNAMIC_SAFETY_TERMS
    )
    return has_rh_safety and has_mtx_safety and has_hemodynamic_safety


def _requires_severe_preeclampsia_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in SEVERE_PREECLAMPSIA_CONTEXT_TERMS
    )


def _has_severe_preeclampsia_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_magnesium = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_PREECLAMPSIA_MAGNESIUM_ACTION_TERMS
    )
    has_antihypertensive = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_PREECLAMPSIA_ANTIHYPERTENSIVE_ACTION_TERMS
    )
    has_delivery_planning = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_PREECLAMPSIA_DELIVERY_ACTION_TERMS
    )
    has_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_PREECLAMPSIA_ESCALATION_ACTION_TERMS
    )
    return (
        has_magnesium
        and has_antihypertensive
        and has_delivery_planning
        and has_escalation
    )


def _has_severe_preeclampsia_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_magnesium_toxicity_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_PREECLAMPSIA_MAGNESIUM_TOX_SAFETY_TERMS
    )
    has_bp_med_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_PREECLAMPSIA_BP_MED_SAFETY_TERMS
    )
    has_lab_organ_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_PREECLAMPSIA_LAB_ORGAN_SAFETY_TERMS
    )
    has_maternal_fetal_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_PREECLAMPSIA_MATERNAL_FETAL_SAFETY_TERMS
    )
    return (
        has_magnesium_toxicity_safety
        and has_bp_med_safety
        and has_lab_organ_safety
        and has_maternal_fetal_safety
    )


def _requires_hypertensive_emergency_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"

    has_direct_context = any(
        _contains_safety_term(risk_text, term)
        for term in HYPERTENSIVE_EMERGENCY_DIRECT_CONTEXT_TERMS
    )
    has_severe_bp_context = any(
        _contains_safety_term(risk_text, term)
        for term in HYPERTENSIVE_EMERGENCY_BP_CONTEXT_TERMS
    )
    has_organ_damage_context = any(
        _contains_safety_term(risk_text, term)
        for term in HYPERTENSIVE_EMERGENCY_ORGAN_CONTEXT_TERMS
    )
    return has_direct_context or (has_severe_bp_context and has_organ_damage_context)


def _has_hypertensive_emergency_time_critical_actions(
    actions: list[Any],
) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_bp_confirmation_monitoring = any(
        _contains_safety_term(normalized_actions, term)
        for term in HYPERTENSIVE_EMERGENCY_BP_CONFIRM_MONITOR_ACTION_TERMS
    )
    has_organ_assessment = any(
        _contains_safety_term(normalized_actions, term)
        for term in HYPERTENSIVE_EMERGENCY_ORGAN_ASSESSMENT_ACTION_TERMS
    )
    has_iv_treatment = any(
        _contains_safety_term(normalized_actions, term)
        for term in HYPERTENSIVE_EMERGENCY_IV_TREATMENT_ACTION_TERMS
    )
    has_bp_target = any(
        _contains_safety_term(normalized_actions, term)
        for term in HYPERTENSIVE_EMERGENCY_BP_TARGET_ACTION_TERMS
    )
    return (
        has_bp_confirmation_monitoring
        and has_organ_assessment
        and has_iv_treatment
        and has_bp_target
    )


def _has_hypertensive_emergency_treatment_safety_check(
    checks: list[Any],
) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_urgency_differentiation = any(
        _contains_safety_term(normalized_checks, term)
        for term in HYPERTENSIVE_EMERGENCY_URGENCY_DIFFERENTIATION_SAFETY_TERMS
    )
    has_overlowering_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in HYPERTENSIVE_EMERGENCY_OVERLOWERING_SAFETY_TERMS
    )
    has_condition_med_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in HYPERTENSIVE_EMERGENCY_CONDITION_MED_SAFETY_TERMS
    )
    has_disposition_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in HYPERTENSIVE_EMERGENCY_DISPOSITION_SAFETY_TERMS
    )
    return (
        has_urgency_differentiation
        and has_overlowering_safety
        and has_condition_med_safety
        and has_disposition_safety
    )


def _requires_giant_cell_arteritis_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"

    has_direct_context = any(
        _contains_safety_term(risk_text, term)
        for term in GIANT_CELL_ARTERITIS_DIRECT_CONTEXT_TERMS
    )
    has_headache_context = any(
        _contains_safety_term(risk_text, term)
        for term in GIANT_CELL_ARTERITIS_HEADACHE_CONTEXT_TERMS
    )
    has_ischemic_context = any(
        _contains_safety_term(risk_text, term)
        for term in GIANT_CELL_ARTERITIS_ISCHEMIC_CONTEXT_TERMS
    )
    return has_direct_context or (has_headache_context and has_ischemic_context)


def _has_giant_cell_arteritis_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_steroid = any(
        _contains_safety_term(normalized_actions, term)
        for term in GIANT_CELL_ARTERITIS_STEROID_ACTION_TERMS
    )
    has_labs = any(
        _contains_safety_term(normalized_actions, term)
        for term in GIANT_CELL_ARTERITIS_LAB_ACTION_TERMS
    )
    has_diagnostic_confirmation = any(
        _contains_safety_term(normalized_actions, term)
        for term in GIANT_CELL_ARTERITIS_DIAGNOSTIC_ACTION_TERMS
    )
    has_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in GIANT_CELL_ARTERITIS_ESCALATION_ACTION_TERMS
    )
    return has_steroid and has_labs and has_diagnostic_confirmation and has_escalation


def _has_giant_cell_arteritis_treatment_safety_check(
    checks: list[Any],
) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_do_not_delay = any(
        _contains_safety_term(normalized_checks, term)
        for term in GIANT_CELL_ARTERITIS_DO_NOT_DELAY_SAFETY_TERMS
    )
    has_vision_ischemia_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in GIANT_CELL_ARTERITIS_VISION_ISCHEMIA_SAFETY_TERMS
    )
    has_steroid_risk_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in GIANT_CELL_ARTERITIS_STEROID_RISK_SAFETY_TERMS
    )
    has_followup_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in GIANT_CELL_ARTERITIS_FOLLOWUP_SAFETY_TERMS
    )
    return (
        has_do_not_delay
        and has_vision_ischemia_safety
        and has_steroid_risk_safety
        and has_followup_safety
    )


def _requires_acute_angle_closure_glaucoma_safety_check(
    data: dict[str, Any],
) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"

    has_direct_context = any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_ANGLE_CLOSURE_GLAUCOMA_DIRECT_CONTEXT_TERMS
    )
    has_red_eye_context = any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_ANGLE_CLOSURE_GLAUCOMA_RED_EYE_CONTEXT_TERMS
    )
    has_angle_context = any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_ANGLE_CLOSURE_GLAUCOMA_ANGLE_CONTEXT_TERMS
    )
    return has_direct_context or (has_red_eye_context and has_angle_context)


def _has_acute_angle_closure_glaucoma_time_critical_actions(
    actions: list[Any],
) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_iop_assessment = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_ANGLE_CLOSURE_GLAUCOMA_IOP_ASSESSMENT_ACTION_TERMS
    )
    has_aqueous_suppression = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_ANGLE_CLOSURE_GLAUCOMA_AQUEOUS_SUPPRESSANT_ACTION_TERMS
    )
    has_systemic_iop_lowering = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_ANGLE_CLOSURE_GLAUCOMA_SYSTEMIC_IOP_ACTION_TERMS
    )
    has_definitive_plan = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_ANGLE_CLOSURE_GLAUCOMA_DEFINITIVE_ACTION_TERMS
    )
    return (
        has_iop_assessment
        and has_aqueous_suppression
        and has_systemic_iop_lowering
        and has_definitive_plan
    )


def _has_acute_angle_closure_glaucoma_treatment_safety_check(
    checks: list[Any],
) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_med_contra_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_ANGLE_CLOSURE_GLAUCOMA_MED_CONTRA_SAFETY_TERMS
    )
    has_pilocarpine_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_ANGLE_CLOSURE_GLAUCOMA_PILOCARPINE_SAFETY_TERMS
    )
    has_fellow_eye_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_ANGLE_CLOSURE_GLAUCOMA_FELLOW_EYE_SAFETY_TERMS
    )
    has_monitoring_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_ANGLE_CLOSURE_GLAUCOMA_MONITORING_SAFETY_TERMS
    )
    return (
        has_med_contra_safety
        and has_pilocarpine_safety
        and has_fellow_eye_safety
        and has_monitoring_safety
    )


def _requires_neutropenic_fever_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in NEUTROPENIC_FEVER_CONTEXT_TERMS
    )


def _has_neutropenic_fever_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_anc_check = any(
        _contains_safety_term(normalized_actions, term)
        for term in NEUTROPENIC_FEVER_ANC_ACTION_TERMS
    )
    has_cultures = any(
        _contains_safety_term(normalized_actions, term)
        for term in NEUTROPENIC_FEVER_CULTURE_ACTION_TERMS
    )
    has_antipseudomonal_antibiotics = any(
        _contains_safety_term(normalized_actions, term)
        for term in NEUTROPENIC_FEVER_ANTIPSEUDOMONAL_ACTION_TERMS
    )
    has_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in NEUTROPENIC_FEVER_ESCALATION_ACTION_TERMS
    )
    return (
        has_anc_check
        and has_cultures
        and has_antipseudomonal_antibiotics
        and has_escalation
    )


def _has_neutropenic_fever_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_antibiotic_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in NEUTROPENIC_FEVER_ANTIBIOTIC_SAFETY_TERMS
    )
    has_catheter_resistance_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in NEUTROPENIC_FEVER_CATHETER_RESISTANCE_SAFETY_TERMS
    )
    has_risk_disposition_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in NEUTROPENIC_FEVER_RISK_DISPOSITION_SAFETY_TERMS
    )
    has_reassessment_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in NEUTROPENIC_FEVER_REASSESSMENT_SAFETY_TERMS
    )
    return (
        has_antibiotic_safety
        and has_catheter_resistance_safety
        and has_risk_disposition_safety
        and has_reassessment_safety
    )


def _requires_obstructive_pyelonephritis_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"

    has_combined_context = any(
        _contains_safety_term(risk_text, term)
        for term in OBSTRUCTIVE_PYELONEPHRITIS_COMBINED_CONTEXT_TERMS
    )
    has_infection_context = any(
        _contains_safety_term(risk_text, term)
        for term in OBSTRUCTIVE_PYELONEPHRITIS_INFECTION_CONTEXT_TERMS
    )
    has_obstruction_context = any(
        _contains_safety_term(risk_text, term)
        for term in OBSTRUCTIVE_PYELONEPHRITIS_OBSTRUCTION_CONTEXT_TERMS
    )
    return has_combined_context or (has_infection_context and has_obstruction_context)


def _has_obstructive_pyelonephritis_time_critical_actions(
    actions: list[Any],
) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_antibiotics_and_cultures = any(
        _contains_safety_term(normalized_actions, term)
        for term in OBSTRUCTIVE_PYELONEPHRITIS_CULTURE_ANTIBIOTIC_ACTION_TERMS
    )
    has_obstruction_imaging = any(
        _contains_safety_term(normalized_actions, term)
        for term in OBSTRUCTIVE_PYELONEPHRITIS_IMAGING_OBSTRUCTION_ACTION_TERMS
    )
    has_decompression = any(
        _contains_safety_term(normalized_actions, term)
        for term in OBSTRUCTIVE_PYELONEPHRITIS_DECOMPRESSION_ACTION_TERMS
    )
    has_sepsis_support = any(
        _contains_safety_term(normalized_actions, term)
        for term in OBSTRUCTIVE_PYELONEPHRITIS_SEPSIS_SUPPORT_ACTION_TERMS
    )
    return (
        has_antibiotics_and_cultures
        and has_obstruction_imaging
        and has_decompression
        and has_sepsis_support
    )


def _has_obstructive_pyelonephritis_treatment_safety_check(
    checks: list[Any],
) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_delayed_stone_treatment = any(
        _contains_safety_term(normalized_checks, term)
        for term in OBSTRUCTIVE_PYELONEPHRITIS_DELAY_STONE_SAFETY_TERMS
    )
    has_drainage_option_review = any(
        _contains_safety_term(normalized_checks, term)
        for term in OBSTRUCTIVE_PYELONEPHRITIS_DRAINAGE_OPTION_SAFETY_TERMS
    )
    has_antibiotic_reassessment = any(
        _contains_safety_term(normalized_checks, term)
        for term in OBSTRUCTIVE_PYELONEPHRITIS_ANTIBIOTIC_REASSESSMENT_SAFETY_TERMS
    )
    has_complication_risk_review = any(
        _contains_safety_term(normalized_checks, term)
        for term in OBSTRUCTIVE_PYELONEPHRITIS_COMPLICATION_RISK_SAFETY_TERMS
    )
    return (
        has_delayed_stone_treatment
        and has_drainage_option_review
        and has_antibiotic_reassessment
        and has_complication_risk_review
    )


def _requires_severe_hypoglycemia_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in SEVERE_HYPOGLYCEMIA_CONTEXT_TERMS
    )


def _has_severe_hypoglycemia_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_glucose_check = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_HYPOGLYCEMIA_GLUCOSE_CHECK_ACTION_TERMS
    )
    has_dextrose_or_glucagon = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_HYPOGLYCEMIA_DEXTROSE_GLUCAGON_ACTION_TERMS
    )
    has_recheck_feeding = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_HYPOGLYCEMIA_RECHECK_FEEDING_ACTION_TERMS
    )
    has_escalation_or_cause = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_HYPOGLYCEMIA_ESCALATION_CAUSE_ACTION_TERMS
    )
    return (
        has_glucose_check
        and has_dextrose_or_glucagon
        and has_recheck_feeding
        and has_escalation_or_cause
    )


def _has_severe_hypoglycemia_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_route_airway_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_HYPOGLYCEMIA_ROUTE_AIRWAY_SAFETY_TERMS
    )
    has_recurrence_med_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_HYPOGLYCEMIA_RECURRENCE_MED_SAFETY_TERMS
    )
    has_cause_risk_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_HYPOGLYCEMIA_CAUSE_RISK_SAFETY_TERMS
    )
    has_discharge_prevention_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_HYPOGLYCEMIA_DISCHARGE_PREVENTION_SAFETY_TERMS
    )
    return (
        has_route_airway_safety
        and has_recurrence_med_safety
        and has_cause_risk_safety
        and has_discharge_prevention_safety
    )


def _requires_malignant_hyperthermia_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in MALIGNANT_HYPERTHERMIA_CONTEXT_TERMS
    )


def _has_malignant_hyperthermia_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_trigger_stop = any(
        _contains_safety_term(normalized_actions, term)
        for term in MALIGNANT_HYPERTHERMIA_TRIGGER_STOP_ACTION_TERMS
    )
    has_dantrolene = any(
        _contains_safety_term(normalized_actions, term)
        for term in MALIGNANT_HYPERTHERMIA_DANTROLENE_ACTION_TERMS
    )
    has_cooling = any(
        _contains_safety_term(normalized_actions, term)
        for term in MALIGNANT_HYPERTHERMIA_COOLING_ACTION_TERMS
    )
    has_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in MALIGNANT_HYPERTHERMIA_ESCALATION_ACTION_TERMS
    )
    return has_trigger_stop and has_dantrolene and has_cooling and has_escalation


def _has_malignant_hyperthermia_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_metabolic_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in MALIGNANT_HYPERTHERMIA_METABOLIC_SAFETY_TERMS
    )
    has_monitoring_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in MALIGNANT_HYPERTHERMIA_MONITORING_SAFETY_TERMS
    )
    has_dantrolene_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in MALIGNANT_HYPERTHERMIA_DANTROLENE_SAFETY_TERMS
    )
    has_trigger_prevention_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in MALIGNANT_HYPERTHERMIA_TRIGGER_PREVENTION_SAFETY_TERMS
    )
    return (
        has_metabolic_safety
        and has_monitoring_safety
        and has_dantrolene_safety
        and has_trigger_prevention_safety
    )


def _requires_thyroid_storm_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in THYROID_STORM_CONTEXT_TERMS
    )


def _has_thyroid_storm_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_beta_blocker = any(
        _contains_safety_term(normalized_actions, term)
        for term in THYROID_STORM_BETA_BLOCKER_ACTION_TERMS
    )
    has_thionamide = any(
        _contains_safety_term(normalized_actions, term)
        for term in THYROID_STORM_THIONAMIDE_ACTION_TERMS
    )
    has_iodine = any(
        _contains_safety_term(normalized_actions, term)
        for term in THYROID_STORM_IODINE_ACTION_TERMS
    )
    has_steroid_support = any(
        _contains_safety_term(normalized_actions, term)
        for term in THYROID_STORM_STEROID_SUPPORT_ACTION_TERMS
    )
    return has_beta_blocker and has_thionamide and has_iodine and has_steroid_support


def _has_thyroid_storm_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_sequence_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in THYROID_STORM_SEQUENCE_SAFETY_TERMS
    )
    has_beta_blocker_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in THYROID_STORM_BETA_BLOCKER_SAFETY_TERMS
    )
    has_drug_liver_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in THYROID_STORM_DRUG_LIVER_SAFETY_TERMS
    )
    has_trigger_monitoring_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in THYROID_STORM_TRIGGER_MONITORING_SAFETY_TERMS
    )
    return (
        has_sequence_safety
        and has_beta_blocker_safety
        and has_drug_liver_safety
        and has_trigger_monitoring_safety
    )


def _requires_heat_stroke_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in HEAT_STROKE_CONTEXT_TERMS
    )


def _has_heat_stroke_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_core_temp = any(
        _contains_safety_term(normalized_actions, term)
        for term in HEAT_STROKE_CORE_TEMP_ACTION_TERMS
    )
    has_rapid_cooling = any(
        _contains_safety_term(normalized_actions, term)
        for term in HEAT_STROKE_RAPID_COOLING_ACTION_TERMS
    )
    has_abc_fluid = any(
        _contains_safety_term(normalized_actions, term)
        for term in HEAT_STROKE_ABC_FLUID_ACTION_TERMS
    )
    has_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in HEAT_STROKE_ESCALATION_ACTION_TERMS
    )
    return has_core_temp and has_rapid_cooling and has_abc_fluid and has_escalation


def _has_heat_stroke_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_overcooling_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in HEAT_STROKE_OVERCOOLING_SAFETY_TERMS
    )
    has_organ_injury_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in HEAT_STROKE_ORGAN_INJURY_SAFETY_TERMS
    )
    has_antipyretic_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in HEAT_STROKE_ANTIPYRETIC_SAFETY_TERMS
    )
    has_differential_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in HEAT_STROKE_DIFFERENTIAL_SAFETY_TERMS
    )
    return (
        has_overcooling_safety
        and has_organ_injury_safety
        and has_antipyretic_safety
        and has_differential_safety
    )


def _requires_cauda_equina_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in CAUDA_EQUINA_CONTEXT_TERMS
    )


def _has_cauda_equina_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_mri = any(
        _contains_safety_term(normalized_actions, term)
        for term in CAUDA_EQUINA_MRI_ACTION_TERMS
    )
    has_bladder_assessment = any(
        _contains_safety_term(normalized_actions, term)
        for term in CAUDA_EQUINA_BLADDER_ACTION_TERMS
    )
    has_neuro_exam = any(
        _contains_safety_term(normalized_actions, term)
        for term in CAUDA_EQUINA_NEURO_EXAM_ACTION_TERMS
    )
    has_spine_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in CAUDA_EQUINA_SPINE_ESCALATION_ACTION_TERMS
    )
    return has_mri and has_bladder_assessment and has_neuro_exam and has_spine_escalation


def _has_cauda_equina_delay_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_red_flag_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CAUDA_EQUINA_RED_FLAG_SAFETY_TERMS
    )
    has_delay_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CAUDA_EQUINA_DELAY_SAFETY_TERMS
    )
    has_compressive_cause_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CAUDA_EQUINA_COMPRESSIVE_CAUSE_SAFETY_TERMS
    )
    return has_red_flag_safety and has_delay_safety and has_compressive_cause_safety


def _requires_acute_compartment_syndrome_safety_check(
    data: dict[str, Any],
) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"

    has_direct_context = any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_COMPARTMENT_SYNDROME_CONTEXT_TERMS
    )
    has_risk_context = any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_COMPARTMENT_SYNDROME_RISK_CONTEXT_TERMS
    )
    has_symptom_context = any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_COMPARTMENT_SYNDROME_SYMPTOM_CONTEXT_TERMS
    )
    return has_direct_context or (has_risk_context and has_symptom_context)


def _has_acute_compartment_syndrome_time_critical_actions(
    actions: list[Any],
) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_limb_exam = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_COMPARTMENT_SYNDROME_EXAM_ACTION_TERMS
    )
    has_pressure_pathway = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_COMPARTMENT_SYNDROME_PRESSURE_ACTION_TERMS
    )
    has_decompression = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_COMPARTMENT_SYNDROME_DECOMPRESSION_ACTION_TERMS
    )
    has_temporizing_release = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_COMPARTMENT_SYNDROME_TEMPORIZE_ACTION_TERMS
    )
    return (
        has_limb_exam
        and has_pressure_pathway
        and has_decompression
        and has_temporizing_release
    )


def _has_acute_compartment_syndrome_treatment_safety_check(
    checks: list[Any],
) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_delay_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_COMPARTMENT_SYNDROME_DELAY_SAFETY_TERMS
    )
    has_masking_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_COMPARTMENT_SYNDROME_MASKING_SAFETY_TERMS
    )
    has_complication_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_COMPARTMENT_SYNDROME_COMPLICATION_SAFETY_TERMS
    )
    has_cause_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_COMPARTMENT_SYNDROME_CAUSE_SAFETY_TERMS
    )
    return (
        has_delay_safety
        and has_masking_safety
        and has_complication_safety
        and has_cause_safety
    )


def _requires_acute_limb_ischemia_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_LIMB_ISCHEMIA_CONTEXT_TERMS
    )


def _has_acute_limb_ischemia_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_viability_assessment = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_LIMB_ISCHEMIA_VIABILITY_ACTION_TERMS
    )
    has_heparin = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_LIMB_ISCHEMIA_HEPARIN_ACTION_TERMS
    )
    has_revascularization = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_LIMB_ISCHEMIA_REVASCULARIZATION_ACTION_TERMS
    )
    return has_viability_assessment and has_heparin and has_revascularization


def _has_acute_limb_ischemia_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_bleeding_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_LIMB_ISCHEMIA_BLEEDING_SAFETY_TERMS
    )
    has_irreversible_compartment_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_LIMB_ISCHEMIA_IRREVERSIBLE_COMPARTMENT_SAFETY_TERMS
    )
    has_source_differential_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_LIMB_ISCHEMIA_SOURCE_DIFFERENTIAL_SAFETY_TERMS
    )
    return (
        has_bleeding_safety
        and has_irreversible_compartment_safety
        and has_source_differential_safety
    )


def _requires_testicular_torsion_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in TESTICULAR_TORSION_CONTEXT_TERMS
    )


def _has_testicular_torsion_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_assessment = any(
        _contains_safety_term(normalized_actions, term)
        for term in TESTICULAR_TORSION_ASSESSMENT_ACTION_TERMS
    )
    has_urology_surgery = any(
        _contains_safety_term(normalized_actions, term)
        for term in TESTICULAR_TORSION_UROLOGY_SURGERY_ACTION_TERMS
    )
    has_delay_prevention = any(
        _contains_safety_term(normalized_actions, term)
        for term in TESTICULAR_TORSION_DELAY_ACTION_TERMS
    )
    return has_assessment and has_urology_surgery and has_delay_prevention


def _has_testicular_torsion_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_salvage_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in TESTICULAR_TORSION_SALVAGE_SAFETY_TERMS
    )
    has_manual_detorsion_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in TESTICULAR_TORSION_MANUAL_DETORSION_SAFETY_TERMS
    )
    has_bilateral_fixation_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in TESTICULAR_TORSION_BILATERAL_FIXATION_SAFETY_TERMS
    )
    has_differential_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in TESTICULAR_TORSION_DIFFERENTIAL_SAFETY_TERMS
    )
    return (
        has_salvage_safety
        and has_manual_detorsion_safety
        and has_bilateral_fixation_safety
        and has_differential_safety
    )


def _requires_ovarian_torsion_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in OVARIAN_TORSION_CONTEXT_TERMS
    )


def _has_ovarian_torsion_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_pregnancy_assessment = any(
        _contains_safety_term(normalized_actions, term)
        for term in OVARIAN_TORSION_PREGNANCY_ACTION_TERMS
    )
    has_ultrasound_assessment = any(
        _contains_safety_term(normalized_actions, term)
        for term in OVARIAN_TORSION_ULTRASOUND_ACTION_TERMS
    )
    has_surgical_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in OVARIAN_TORSION_SURGICAL_ACTION_TERMS
    )
    return has_pregnancy_assessment and has_ultrasound_assessment and has_surgical_escalation


def _has_ovarian_torsion_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_doppler_delay_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in OVARIAN_TORSION_DOPPLER_DELAY_SAFETY_TERMS
    )
    has_preservation_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in OVARIAN_TORSION_PRESERVATION_SAFETY_TERMS
    )
    has_differential_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in OVARIAN_TORSION_DIFFERENTIAL_SAFETY_TERMS
    )
    return has_doppler_delay_safety and has_preservation_safety and has_differential_safety


def _requires_spinal_epidural_abscess_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in SPINAL_EPIDURAL_ABSCESS_CONTEXT_TERMS
    )


def _has_spinal_epidural_abscess_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_mri = any(
        _contains_safety_term(normalized_actions, term)
        for term in SPINAL_EPIDURAL_ABSCESS_MRI_ACTION_TERMS
    )
    has_culture_lab = any(
        _contains_safety_term(normalized_actions, term)
        for term in SPINAL_EPIDURAL_ABSCESS_CULTURE_LAB_ACTION_TERMS
    )
    has_antibiotic = any(
        _contains_safety_term(normalized_actions, term)
        for term in SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_ACTION_TERMS
    )
    has_surgery = any(
        _contains_safety_term(normalized_actions, term)
        for term in SPINAL_EPIDURAL_ABSCESS_SURGERY_ACTION_TERMS
    )
    return has_mri and has_culture_lab and has_antibiotic and has_surgery


def _has_spinal_epidural_abscess_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_neuro_sepsis_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SPINAL_EPIDURAL_ABSCESS_NEURO_SEPSIS_SAFETY_TERMS
    )
    has_risk_source_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SPINAL_EPIDURAL_ABSCESS_RISK_SOURCE_SAFETY_TERMS
    )
    has_antibiotic_timing_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SPINAL_EPIDURAL_ABSCESS_ANTIBIOTIC_TIMING_SAFETY_TERMS
    )
    return (
        has_neuro_sepsis_safety
        and has_risk_source_safety
        and has_antibiotic_timing_safety
    )


def _requires_septic_arthritis_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in SEPTIC_ARTHRITIS_CONTEXT_TERMS
    )


def _has_septic_arthritis_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_arthrocentesis = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEPTIC_ARTHRITIS_ARTHROCENTESIS_ACTION_TERMS
    )
    has_synovial_studies = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEPTIC_ARTHRITIS_SYNOVIAL_STUDY_ACTION_TERMS
    )
    has_blood_culture_lab = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEPTIC_ARTHRITIS_BLOOD_CULTURE_LAB_ACTION_TERMS
    )
    has_antibiotic = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEPTIC_ARTHRITIS_ANTIBIOTIC_ACTION_TERMS
    )
    has_drainage_ortho = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEPTIC_ARTHRITIS_DRAINAGE_ORTHO_ACTION_TERMS
    )
    return (
        has_arthrocentesis
        and has_synovial_studies
        and has_blood_culture_lab
        and has_antibiotic
        and has_drainage_ortho
    )


def _has_septic_arthritis_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_crystal_limitation = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEPTIC_ARTHRITIS_CRYSTAL_LIMITATION_SAFETY_TERMS
    )
    has_antibiotic_timing = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEPTIC_ARTHRITIS_ANTIBIOTIC_TIMING_SAFETY_TERMS
    )
    has_pathogen_risk = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEPTIC_ARTHRITIS_PATHOGEN_RISK_SAFETY_TERMS
    )
    has_complication_source = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEPTIC_ARTHRITIS_COMPLICATION_SOURCE_SAFETY_TERMS
    )
    return (
        has_crystal_limitation
        and has_antibiotic_timing
        and has_pathogen_risk
        and has_complication_source
    )


def _requires_upper_gi_bleed_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in UPPER_GI_BLEED_CONTEXT_TERMS
    )


def _has_upper_gi_bleed_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_resuscitation = any(
        _contains_safety_term(normalized_actions, term)
        for term in UPPER_GI_BLEED_RESUSCITATION_ACTION_TERMS
    )
    has_transfusion_lab = any(
        _contains_safety_term(normalized_actions, term)
        for term in UPPER_GI_BLEED_TRANSFUSION_LAB_ACTION_TERMS
    )
    has_endoscopy = any(
        _contains_safety_term(normalized_actions, term)
        for term in UPPER_GI_BLEED_ENDOSCOPY_ACTION_TERMS
    )
    has_ppi_variceal_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in UPPER_GI_BLEED_PPI_VARICEAL_ACTION_TERMS
    )
    return (
        has_resuscitation
        and has_transfusion_lab
        and has_endoscopy
        and has_ppi_variceal_action
    )


def _has_upper_gi_bleed_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_airway_aspiration_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in UPPER_GI_BLEED_AIRWAY_ASPIRATION_SAFETY_TERMS
    )
    has_antithrombotic_reversal_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in UPPER_GI_BLEED_ANTITHROMBOTIC_REVERSAL_SAFETY_TERMS
    )
    has_variceal_rescue_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in UPPER_GI_BLEED_VARICEAL_RESCUE_SAFETY_TERMS
    )
    has_rebleed_disposition_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in UPPER_GI_BLEED_REBLEED_DISPOSITION_SAFETY_TERMS
    )
    return (
        has_airway_aspiration_safety
        and has_antithrombotic_reversal_safety
        and has_variceal_rescue_safety
        and has_rebleed_disposition_safety
    )


def _requires_acute_cholecystitis_safety_check(data: dict[str, Any]) -> bool:
    risk_text_fields = [
        "chief_complaint",
        "history_of_present_illness",
        "diagnosis",
        "coach_guidance",
    ]
    risk_text = " ".join(
        str(data.get(field_name, "")).lower()
        for field_name in risk_text_fields
    )
    return any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_CHOLECYSTITIS_CONTEXT_TERMS
    )


def _has_acute_cholecystitis_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_severity = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_CHOLECYSTITIS_SEVERITY_ACTION_TERMS
    )
    has_antibiotic_culture = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_CHOLECYSTITIS_ANTIBIOTIC_CULTURE_ACTION_TERMS
    )
    has_imaging = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_CHOLECYSTITIS_IMAGING_ACTION_TERMS
    )
    has_source_control = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_CHOLECYSTITIS_SOURCE_CONTROL_ACTION_TERMS
    )
    return has_severity and has_antibiotic_culture and has_imaging and has_source_control


def _has_acute_cholecystitis_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_high_risk_drainage = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_CHOLECYSTITIS_HIGH_RISK_DRAINAGE_SAFETY_TERMS
    )
    has_complication = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_CHOLECYSTITIS_COMPLICATION_SAFETY_TERMS
    )
    has_bile_duct_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_CHOLECYSTITIS_BILE_DUCT_SAFETY_TERMS
    )
    has_differential = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_CHOLECYSTITIS_DIFFERENTIAL_SAFETY_TERMS
    )
    return (
        has_high_risk_drainage
        and has_complication
        and has_bile_duct_safety
        and has_differential
    )


def _requires_acute_cholangitis_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_CHOLANGITIS_CONTEXT_TERMS
    )


def _has_acute_cholangitis_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_antibiotic_support = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_CHOLANGITIS_ANTIBIOTIC_SUPPORT_ACTION_TERMS
    )
    has_culture_lab = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_CHOLANGITIS_CULTURE_LAB_ACTION_TERMS
    )
    has_imaging_obstruction = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_CHOLANGITIS_IMAGING_OBSTRUCTION_ACTION_TERMS
    )
    has_drainage = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_CHOLANGITIS_DRAINAGE_ACTION_TERMS
    )
    has_organ_support = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_CHOLANGITIS_ORGAN_SUPPORT_ACTION_TERMS
    )
    return (
        has_antibiotic_support
        and has_culture_lab
        and has_imaging_obstruction
        and has_drainage
        and has_organ_support
    )


def _has_acute_cholangitis_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_severity_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_CHOLANGITIS_SEVERITY_SAFETY_TERMS
    )
    has_drainage_timing_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_CHOLANGITIS_DRAINAGE_TIMING_SAFETY_TERMS
    )
    has_procedure_risk_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_CHOLANGITIS_PROCEDURE_RISK_SAFETY_TERMS
    )
    has_differential_source_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_CHOLANGITIS_DIFFERENTIAL_SOURCE_SAFETY_TERMS
    )
    return (
        has_severity_safety
        and has_drainage_timing_safety
        and has_procedure_risk_safety
        and has_differential_source_safety
    )


def _requires_acute_pancreatitis_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_PANCREATITIS_CONTEXT_TERMS
    )


def _has_acute_pancreatitis_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_fluid = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_PANCREATITIS_FLUID_ACTION_TERMS
    )
    has_analgesia_support = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_PANCREATITIS_ANALGESIA_SUPPORT_ACTION_TERMS
    )
    has_diagnostic_etiology = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_PANCREATITIS_DIAGNOSTIC_ETIOLOGY_ACTION_TERMS
    )
    has_severity_organ = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_PANCREATITIS_SEVERITY_ORGAN_ACTION_TERMS
    )
    return has_fluid and has_analgesia_support and has_diagnostic_etiology and has_severity_organ


def _has_acute_pancreatitis_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_ercp_cholangitis_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_PANCREATITIS_ERCP_CHOLANGITIS_SAFETY_TERMS
    )
    has_antibiotic_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_PANCREATITIS_ANTIBIOTIC_SAFETY_TERMS
    )
    has_nutrition_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_PANCREATITIS_NUTRITION_SAFETY_TERMS
    )
    has_necrosis_procedure_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_PANCREATITIS_NECROSIS_PROCEDURE_SAFETY_TERMS
    )
    return (
        has_ercp_cholangitis_safety
        and has_antibiotic_safety
        and has_nutrition_safety
        and has_necrosis_procedure_safety
    )


def _requires_small_bowel_obstruction_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in SMALL_BOWEL_OBSTRUCTION_CONTEXT_TERMS
    )


def _has_small_bowel_obstruction_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_npo_ng = any(
        _contains_safety_term(normalized_actions, term)
        for term in SMALL_BOWEL_OBSTRUCTION_NPO_NG_ACTION_TERMS
    )
    has_fluid_electrolyte = any(
        _contains_safety_term(normalized_actions, term)
        for term in SMALL_BOWEL_OBSTRUCTION_FLUID_ELECTROLYTE_ACTION_TERMS
    )
    has_ct_transition = any(
        _contains_safety_term(normalized_actions, term)
        for term in SMALL_BOWEL_OBSTRUCTION_CT_TRANSITION_ACTION_TERMS
    )
    has_surgery = any(
        _contains_safety_term(normalized_actions, term)
        for term in SMALL_BOWEL_OBSTRUCTION_SURGERY_ACTION_TERMS
    )
    return has_npo_ng and has_fluid_electrolyte and has_ct_transition and has_surgery


def _has_small_bowel_obstruction_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_strangulation_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SMALL_BOWEL_OBSTRUCTION_STRANGULATION_SAFETY_TERMS
    )
    has_nonoperative_limits = any(
        _contains_safety_term(normalized_checks, term)
        for term in SMALL_BOWEL_OBSTRUCTION_NONOPERATIVE_LIMITS_SAFETY_TERMS
    )
    has_perforation_sepsis = any(
        _contains_safety_term(normalized_checks, term)
        for term in SMALL_BOWEL_OBSTRUCTION_PERFORATION_SEPSIS_SAFETY_TERMS
    )
    has_aspiration_etiology = any(
        _contains_safety_term(normalized_checks, term)
        for term in SMALL_BOWEL_OBSTRUCTION_ASPIRATION_ETIOLOGY_SAFETY_TERMS
    )
    return (
        has_strangulation_safety
        and has_nonoperative_limits
        and has_perforation_sepsis
        and has_aspiration_etiology
    )


def _requires_acute_appendicitis_safety_check(data: dict[str, Any]) -> bool:
    risk_text_fields = [
        "chief_complaint",
        "history_of_present_illness",
        "diagnosis",
        "coach_guidance",
    ]
    risk_text = " ".join(
        str(data.get(field_name, "")).lower()
        for field_name in risk_text_fields
    )
    return any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_APPENDICITIS_CONTEXT_TERMS
    )


def _has_acute_appendicitis_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_risk_imaging = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_APPENDICITIS_RISK_IMAGING_ACTION_TERMS
    )
    has_surgery = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_APPENDICITIS_SURGERY_ACTION_TERMS
    )
    has_antibiotic = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_APPENDICITIS_ANTIBIOTIC_ACTION_TERMS
    )
    has_complication_assessment = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_APPENDICITIS_COMPLICATION_ACTION_TERMS
    )
    return has_risk_imaging and has_surgery and has_antibiotic and has_complication_assessment


def _has_acute_appendicitis_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_nonoperative_selection = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_APPENDICITIS_NONOPERATIVE_SELECTION_SAFETY_TERMS
    )
    has_source_control = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_APPENDICITIS_SOURCE_CONTROL_SAFETY_TERMS
    )
    has_special_population_differential = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_APPENDICITIS_SPECIAL_POPULATION_DIFFERENTIAL_SAFETY_TERMS
    )
    has_peritonitis_sepsis = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_APPENDICITIS_PERITONITIS_SEPSIS_SAFETY_TERMS
    )
    return (
        has_nonoperative_selection
        and has_source_control
        and has_special_population_differential
        and has_peritonitis_sepsis
    )


def _requires_acute_mesenteric_ischemia_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_MESENTERIC_ISCHEMIA_CONTEXT_TERMS
    )


def _has_acute_mesenteric_ischemia_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_cta = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_MESENTERIC_ISCHEMIA_CTA_ACTION_TERMS
    )
    has_resuscitation = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_MESENTERIC_ISCHEMIA_RESUSCITATION_ACTION_TERMS
    )
    has_antibiotic = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_MESENTERIC_ISCHEMIA_ANTIBIOTIC_ACTION_TERMS
    )
    has_surgery_revascularization = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_MESENTERIC_ISCHEMIA_SURGERY_REVASCULARIZATION_ACTION_TERMS
    )
    return has_cta and has_resuscitation and has_antibiotic and has_surgery_revascularization


def _has_acute_mesenteric_ischemia_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_anticoagulation_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_MESENTERIC_ISCHEMIA_ANTICOAGULATION_SAFETY_TERMS
    )
    has_bowel_viability_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_MESENTERIC_ISCHEMIA_BOWEL_VIABILITY_SAFETY_TERMS
    )
    has_cause_type_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_MESENTERIC_ISCHEMIA_CAUSE_TYPE_SAFETY_TERMS
    )
    has_lactate_limitation_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_MESENTERIC_ISCHEMIA_LACTATE_LIMITATION_SAFETY_TERMS
    )
    return (
        has_anticoagulation_safety
        and has_bowel_viability_safety
        and has_cause_type_safety
        and has_lactate_limitation_safety
    )


def _requires_necrotizing_soft_tissue_infection_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in NECROTIZING_SOFT_TISSUE_INFECTION_CONTEXT_TERMS
    )


def _has_necrotizing_soft_tissue_infection_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_surgery = any(
        _contains_safety_term(normalized_actions, term)
        for term in NECROTIZING_SOFT_TISSUE_INFECTION_SURGERY_ACTION_TERMS
    )
    has_antibiotic = any(
        _contains_safety_term(normalized_actions, term)
        for term in NECROTIZING_SOFT_TISSUE_INFECTION_ANTIBIOTIC_ACTION_TERMS
    )
    has_resuscitation = any(
        _contains_safety_term(normalized_actions, term)
        for term in NECROTIZING_SOFT_TISSUE_INFECTION_RESUSCITATION_ACTION_TERMS
    )
    has_delay_prevention = any(
        _contains_safety_term(normalized_actions, term)
        for term in NECROTIZING_SOFT_TISSUE_INFECTION_DELAY_ACTION_TERMS
    )
    return has_surgery and has_antibiotic and has_resuscitation and has_delay_prevention


def _has_necrotizing_soft_tissue_infection_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_toxin_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in NECROTIZING_SOFT_TISSUE_INFECTION_TOXIN_SAFETY_TERMS
    )
    has_repeat_source_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in NECROTIZING_SOFT_TISSUE_INFECTION_REPEAT_SOURCE_SAFETY_TERMS
    )
    has_diagnostic_limitation_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in NECROTIZING_SOFT_TISSUE_INFECTION_DIAGNOSTIC_LIMITATION_SAFETY_TERMS
    )
    has_organ_risk_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in NECROTIZING_SOFT_TISSUE_INFECTION_ORGAN_RISK_SAFETY_TERMS
    )
    return (
        has_toxin_safety
        and has_repeat_source_safety
        and has_diagnostic_limitation_safety
        and has_organ_risk_safety
    )


def _requires_ruptured_aaa_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in RUPTURED_AAA_CONTEXT_TERMS
    )


def _has_ruptured_aaa_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_vascular_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in RUPTURED_AAA_VASCULAR_ACTION_TERMS
    )
    has_hemodynamic_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in RUPTURED_AAA_HEMODYNAMIC_ACTION_TERMS
    )
    has_blood_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in RUPTURED_AAA_BLOOD_ACTION_TERMS
    )
    has_imaging_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in RUPTURED_AAA_IMAGING_ACTION_TERMS
    )
    return (
        has_vascular_action
        and has_hemodynamic_action
        and has_blood_action
        and has_imaging_action
    )


def _has_ruptured_aaa_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_transfer_delay_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in RUPTURED_AAA_TRANSFER_DELAY_SAFETY_TERMS
    )
    has_antithrombotic_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in RUPTURED_AAA_ANTITHROMBOTIC_SAFETY_TERMS
    )
    has_shock_complication_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in RUPTURED_AAA_SHOCK_COMPLICATION_SAFETY_TERMS
    )
    return (
        has_transfer_delay_safety
        and has_antithrombotic_safety
        and has_shock_complication_safety
    )


def _requires_subarachnoid_hemorrhage_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in SUBARACHNOID_HEMORRHAGE_CONTEXT_TERMS
    )


def _has_subarachnoid_hemorrhage_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_ct_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in SUBARACHNOID_HEMORRHAGE_CT_ACTION_TERMS
    )
    has_lp_or_cta_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in SUBARACHNOID_HEMORRHAGE_LP_CTA_ACTION_TERMS
    )
    has_neuro_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in SUBARACHNOID_HEMORRHAGE_NEURO_ACTION_TERMS
    )
    has_bp_or_nimodipine_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in SUBARACHNOID_HEMORRHAGE_BP_NIMODIPINE_ACTION_TERMS
    )
    return (
        has_ct_action
        and has_lp_or_cta_action
        and has_neuro_action
        and has_bp_or_nimodipine_action
    )


def _has_subarachnoid_hemorrhage_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_anticoag_reversal_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SUBARACHNOID_HEMORRHAGE_ANTICOAG_REVERSAL_SAFETY_TERMS
    )
    has_rebleed_bp_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SUBARACHNOID_HEMORRHAGE_REBLEED_BP_SAFETY_TERMS
    )
    has_complication_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SUBARACHNOID_HEMORRHAGE_COMPLICATION_SAFETY_TERMS
    )
    return (
        has_anticoag_reversal_safety
        and has_rebleed_bp_safety
        and has_complication_safety
    )


def _requires_sepsis_resuscitation_safety_check(data: dict[str, Any]) -> bool:
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
        for term in SEPSIS_CONTEXT_TERMS
    )


def _has_sepsis_resuscitation_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_lactate = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEPSIS_LACTATE_ACTION_TERMS
    )
    has_fluids = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEPSIS_FLUID_ACTION_TERMS
    )
    has_vasopressor_or_shock_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEPSIS_VASOPRESSOR_ACTION_TERMS
    )
    return has_lactate and has_fluids and has_vasopressor_or_shock_escalation


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


def _requires_hyperkalemia_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in HYPERKALEMIA_CONTEXT_TERMS
    )


def _has_hyperkalemia_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_calcium = any(
        _contains_safety_term(normalized_actions, term)
        for term in HYPERKALEMIA_CALCIUM_ACTION_TERMS
    )
    has_shift = any(
        _contains_safety_term(normalized_actions, term)
        for term in HYPERKALEMIA_SHIFT_ACTION_TERMS
    )
    has_removal = any(
        _contains_safety_term(normalized_actions, term)
        for term in HYPERKALEMIA_REMOVAL_ACTION_TERMS
    )
    return has_calcium and has_shift and has_removal


def _has_hyperkalemia_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_ecg_monitoring = any(
        _contains_safety_term(normalized_checks, term)
        for term in HYPERKALEMIA_ECG_MONITORING_SAFETY_TERMS
    )
    has_glucose_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in HYPERKALEMIA_GLUCOSE_SAFETY_TERMS
    )
    has_recurrence_review = any(
        _contains_safety_term(normalized_checks, term)
        for term in HYPERKALEMIA_RECURRENCE_SAFETY_TERMS
    )
    return has_ecg_monitoring and has_glucose_safety and has_recurrence_review


def _requires_status_epilepticus_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in STATUS_EPILEPTICUS_CONTEXT_TERMS
    )


def _has_status_epilepticus_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_airway = any(
        _contains_safety_term(normalized_actions, term)
        for term in STATUS_EPILEPTICUS_AIRWAY_ACTION_TERMS
    )
    has_benzo = any(
        _contains_safety_term(normalized_actions, term)
        for term in STATUS_EPILEPTICUS_BENZO_ACTION_TERMS
    )
    has_second_line = any(
        _contains_safety_term(normalized_actions, term)
        for term in STATUS_EPILEPTICUS_SECOND_LINE_ACTION_TERMS
    )
    has_refractory_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in STATUS_EPILEPTICUS_REFRACTORY_ACTION_TERMS
    )
    return has_airway and has_benzo and has_second_line and has_refractory_escalation


def _has_status_epilepticus_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_glucose_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in STATUS_EPILEPTICUS_GLUCOSE_SAFETY_TERMS
    )
    has_respiratory_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in STATUS_EPILEPTICUS_RESPIRATORY_SAFETY_TERMS
    )
    has_asm_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in STATUS_EPILEPTICUS_ASM_SAFETY_TERMS
    )
    return has_glucose_safety and has_respiratory_safety and has_asm_safety


def _requires_adrenal_crisis_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in ADRENAL_CRISIS_CONTEXT_TERMS
    )


def _has_adrenal_crisis_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_steroid = any(
        _contains_safety_term(normalized_actions, term)
        for term in ADRENAL_CRISIS_STEROID_ACTION_TERMS
    )
    has_fluid_or_glucose = any(
        _contains_safety_term(normalized_actions, term)
        for term in ADRENAL_CRISIS_FLUID_GLUCOSE_ACTION_TERMS
    )
    has_monitoring = any(
        _contains_safety_term(normalized_actions, term)
        for term in ADRENAL_CRISIS_MONITORING_ACTION_TERMS
    )
    return has_steroid and has_fluid_or_glucose and has_monitoring


def _has_adrenal_crisis_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_do_not_delay_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ADRENAL_CRISIS_DO_NOT_DELAY_SAFETY_TERMS
    )
    has_monitoring_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ADRENAL_CRISIS_MONITORING_SAFETY_TERMS
    )
    has_precipitant_review = any(
        _contains_safety_term(normalized_checks, term)
        for term in ADRENAL_CRISIS_PRECIPITANT_SAFETY_TERMS
    )
    return has_do_not_delay_safety and has_monitoring_safety and has_precipitant_review


def _requires_acetaminophen_toxicity_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in ACETAMINOPHEN_TOXICITY_CONTEXT_TERMS
    )


def _has_acetaminophen_toxicity_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_level_or_nomogram = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACETAMINOPHEN_LEVEL_NOMOGRAM_ACTION_TERMS
    )
    has_nac = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACETAMINOPHEN_NAC_ACTION_TERMS
    )
    has_hepatic_or_toxicology_monitoring = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACETAMINOPHEN_HEPATIC_TOX_ACTION_TERMS
    )
    return has_level_or_nomogram and has_nac and has_hepatic_or_toxicology_monitoring


def _has_acetaminophen_toxicity_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_timing_formulation_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACETAMINOPHEN_TIMING_FORMULATION_SAFETY_TERMS
    )
    has_nac_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACETAMINOPHEN_NAC_SAFETY_TERMS
    )
    has_hepatic_failure_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACETAMINOPHEN_HEPATIC_FAILURE_SAFETY_TERMS
    )
    return has_timing_formulation_safety and has_nac_safety and has_hepatic_failure_safety


def _requires_toxic_alcohol_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in TOXIC_ALCOHOL_CONTEXT_TERMS
    )


def _has_toxic_alcohol_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_gap_lab_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in TOXIC_ALCOHOL_GAP_LAB_ACTION_TERMS
    )
    has_antidote_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in TOXIC_ALCOHOL_ANTIDOTE_ACTION_TERMS
    )
    has_dialysis_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in TOXIC_ALCOHOL_DIALYSIS_ESCALATION_ACTION_TERMS
    )
    has_acidosis_support = any(
        _contains_safety_term(normalized_actions, term)
        for term in TOXIC_ALCOHOL_ACIDOSIS_SUPPORT_ACTION_TERMS
    )
    return (
        has_gap_lab_action
        and has_antidote_action
        and has_dialysis_escalation
        and has_acidosis_support
    )


def _has_toxic_alcohol_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_dialysis_indication_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in TOXIC_ALCOHOL_DIALYSIS_INDICATION_SAFETY_TERMS
    )
    has_organ_injury_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in TOXIC_ALCOHOL_ORGAN_INJURY_SAFETY_TERMS
    )
    has_coingestion_differential_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in TOXIC_ALCOHOL_COINGESTION_DIFFERENTIAL_SAFETY_TERMS
    )
    return (
        has_dialysis_indication_safety
        and has_organ_injury_safety
        and has_coingestion_differential_safety
    )


def _requires_salicylate_toxicity_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in SALICYLATE_TOXICITY_CONTEXT_TERMS
    )


def _has_salicylate_toxicity_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_level_acid_base_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in SALICYLATE_LEVEL_ACID_BASE_ACTION_TERMS
    )
    has_decontamination_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in SALICYLATE_DECONTAMINATION_ACTION_TERMS
    )
    has_alkalinization_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in SALICYLATE_ALKALINIZATION_ACTION_TERMS
    )
    has_dialysis_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in SALICYLATE_DIALYSIS_ESCALATION_ACTION_TERMS
    )
    return (
        has_level_acid_base_action
        and has_decontamination_action
        and has_alkalinization_action
        and has_dialysis_escalation
    )


def _has_salicylate_toxicity_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_dialysis_indication_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SALICYLATE_DIALYSIS_INDICATION_SAFETY_TERMS
    )
    has_intubation_ph_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SALICYLATE_INTUBATION_PH_SAFETY_TERMS
    )
    has_electrolyte_glucose_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SALICYLATE_ELECTROLYTE_GLUCOSE_SAFETY_TERMS
    )
    return (
        has_dialysis_indication_safety
        and has_intubation_ph_safety
        and has_electrolyte_glucose_safety
    )


def _requires_carbon_monoxide_poisoning_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in CARBON_MONOXIDE_CONTEXT_TERMS
    )


def _has_carbon_monoxide_poisoning_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_removal_oxygen_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in CARBON_MONOXIDE_REMOVAL_OXYGEN_ACTION_TERMS
    )
    has_cohb_diagnostic_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in CARBON_MONOXIDE_COHB_DIAGNOSTIC_ACTION_TERMS
    )
    has_hyperbaric_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in CARBON_MONOXIDE_HYPERBARIC_ACTION_TERMS
    )
    has_cardiac_neuro_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in CARBON_MONOXIDE_CARDIAC_NEURO_ACTION_TERMS
    )
    return (
        has_removal_oxygen_action
        and has_cohb_diagnostic_action
        and has_hyperbaric_action
        and has_cardiac_neuro_action
    )


def _has_carbon_monoxide_poisoning_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_pulse_ox_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CARBON_MONOXIDE_PULSE_OX_SAFETY_TERMS
    )
    has_hbo_criteria_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CARBON_MONOXIDE_HBO_CRITERIA_SAFETY_TERMS
    )
    has_complication_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CARBON_MONOXIDE_COMPLICATION_SAFETY_TERMS
    )
    has_cyanide_smoke_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CARBON_MONOXIDE_CYANIDE_SMOKE_SAFETY_TERMS
    )
    return (
        has_pulse_ox_safety
        and has_hbo_criteria_safety
        and has_complication_safety
        and has_cyanide_smoke_safety
    )


def _requires_cyanide_poisoning_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in CYANIDE_POISONING_CONTEXT_TERMS
    )


def _has_cyanide_poisoning_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_removal_oxygen_support = any(
        _contains_safety_term(normalized_actions, term)
        for term in CYANIDE_REMOVAL_OXYGEN_SUPPORT_ACTION_TERMS
    )
    has_antidote_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in CYANIDE_HYDROXOCOBALAMIN_ACTION_TERMS
    )
    has_lactate_acidosis_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in CYANIDE_LACTATE_ACIDOSIS_ACTION_TERMS
    )
    has_poison_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in CYANIDE_POISON_ESCALATION_ACTION_TERMS
    )
    return (
        has_removal_oxygen_support
        and has_antidote_action
        and has_lactate_acidosis_action
        and has_poison_escalation
    )


def _has_cyanide_poisoning_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_do_not_wait_level_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CYANIDE_DO_NOT_WAIT_LEVEL_SAFETY_TERMS
    )
    has_smoke_co_nitrite_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CYANIDE_SMOKE_CO_NITRITE_SAFETY_TERMS
    )
    has_shock_neuro_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CYANIDE_SHOCK_NEURO_SAFETY_TERMS
    )
    has_hydroxocobalamin_effect_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CYANIDE_HYDROXOCOBALAMIN_EFFECT_SAFETY_TERMS
    )
    return (
        has_do_not_wait_level_safety
        and has_smoke_co_nitrite_safety
        and has_shock_neuro_safety
        and has_hydroxocobalamin_effect_safety
    )


def _requires_opioid_toxicity_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in OPIOID_TOXICITY_CONTEXT_TERMS
    )


def _has_opioid_toxicity_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_airway_ventilation = any(
        _contains_safety_term(normalized_actions, term)
        for term in OPIOID_AIRWAY_VENTILATION_ACTION_TERMS
    )
    has_naloxone = any(
        _contains_safety_term(normalized_actions, term)
        for term in OPIOID_NALOXONE_ACTION_TERMS
    )
    has_recurrent_depression_monitoring = any(
        _contains_safety_term(normalized_actions, term)
        for term in OPIOID_RECURRENT_DEPRESSION_ACTION_TERMS
    )
    return has_airway_ventilation and has_naloxone and has_recurrent_depression_monitoring


def _has_opioid_toxicity_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_long_acting_rebound_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in OPIOID_LONG_ACTING_REBOUND_SAFETY_TERMS
    )
    has_coingestion_or_differential_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in OPIOID_COINGESTION_DIFFERENTIAL_SAFETY_TERMS
    )
    has_naloxone_adverse_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in OPIOID_NALOXONE_ADVERSE_SAFETY_TERMS
    )
    return (
        has_long_acting_rebound_safety
        and has_coingestion_or_differential_safety
        and has_naloxone_adverse_safety
    )


def _requires_severe_asthma_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in SEVERE_ASTHMA_CONTEXT_TERMS
    )


def _has_severe_asthma_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_oxygen_or_ventilation = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_ASTHMA_OXYGEN_VENTILATION_ACTION_TERMS
    )
    has_saba = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_ASTHMA_SABA_ACTION_TERMS
    )
    has_ipratropium = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_ASTHMA_IPRATROPIUM_ACTION_TERMS
    )
    has_systemic_steroid = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_ASTHMA_STEROID_ACTION_TERMS
    )
    has_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_ASTHMA_ESCALATION_ACTION_TERMS
    )
    return (
        has_oxygen_or_ventilation
        and has_saba
        and has_ipratropium
        and has_systemic_steroid
        and has_escalation
    )


def _has_severe_asthma_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_response_monitoring = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_ASTHMA_RESPONSE_MONITORING_SAFETY_TERMS
    )
    has_respiratory_failure_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_ASTHMA_RESPIRATORY_FAILURE_SAFETY_TERMS
    )
    has_treatment_adverse_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_ASTHMA_TREATMENT_ADVERSE_SAFETY_TERMS
    )
    return (
        has_response_monitoring
        and has_respiratory_failure_safety
        and has_treatment_adverse_safety
    )


def _requires_severe_cap_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in SEVERE_CAP_CONTEXT_TERMS
    )


def _has_severe_cap_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_oxygen_ventilation = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_CAP_OXYGEN_VENTILATION_ACTION_TERMS
    )
    has_diagnostic_culture = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_CAP_DIAGNOSTIC_CULTURE_ACTION_TERMS
    )
    has_empiric_antibiotic = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_CAP_EMPIRIC_ANTIBIOTIC_ACTION_TERMS
    )
    has_sepsis_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in SEVERE_CAP_SEPSIS_ESCALATION_ACTION_TERMS
    )
    return (
        has_oxygen_ventilation
        and has_diagnostic_culture
        and has_empiric_antibiotic
        and has_sepsis_escalation
    )


def _has_severe_cap_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_mrsa_pseudomonas_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_CAP_MRSA_PSEUDOMONAS_SAFETY_TERMS
    )
    has_severity_disposition_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_CAP_SEVERITY_DISPOSITION_SAFETY_TERMS
    )
    has_effusion_empyema_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_CAP_EFFUSION_EMPYEMA_SAFETY_TERMS
    )
    has_viral_aspiration_differential_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in SEVERE_CAP_VIRAL_ASPIRATION_DIFFERENTIAL_SAFETY_TERMS
    )
    return (
        has_mrsa_pseudomonas_safety
        and has_severity_disposition_safety
        and has_effusion_empyema_safety
        and has_viral_aspiration_differential_safety
    )


def _requires_copd_exacerbation_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in COPD_EXACERBATION_CONTEXT_TERMS
    )


def _has_copd_exacerbation_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_controlled_oxygen = any(
        _contains_safety_term(normalized_actions, term)
        for term in COPD_CONTROLLED_OXYGEN_ACTION_TERMS
    )
    has_bronchodilator = any(
        _contains_safety_term(normalized_actions, term)
        for term in COPD_BRONCHODILATOR_ACTION_TERMS
    )
    has_systemic_steroid = any(
        _contains_safety_term(normalized_actions, term)
        for term in COPD_STEROID_ACTION_TERMS
    )
    has_antibiotic_criteria = any(
        _contains_safety_term(normalized_actions, term)
        for term in COPD_ANTIBIOTIC_CRITERIA_ACTION_TERMS
    )
    has_ventilatory_support = any(
        _contains_safety_term(normalized_actions, term)
        for term in COPD_VENTILATORY_SUPPORT_ACTION_TERMS
    )
    return (
        has_controlled_oxygen
        and has_bronchodilator
        and has_systemic_steroid
        and has_antibiotic_criteria
        and has_ventilatory_support
    )


def _has_copd_exacerbation_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_oxygen_co2_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in COPD_OXYGEN_CO2_SAFETY_TERMS
    )
    has_niv_intubation_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in COPD_NIV_INTUBATION_SAFETY_TERMS
    )
    has_differential_review = any(
        _contains_safety_term(normalized_checks, term)
        for term in COPD_COMORBID_DIFFERENTIAL_SAFETY_TERMS
    )
    has_treatment_adverse_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in COPD_TREATMENT_ADVERSE_SAFETY_TERMS
    )
    return (
        has_oxygen_co2_safety
        and has_niv_intubation_safety
        and has_differential_review
        and has_treatment_adverse_safety
    )


def _requires_acute_heart_failure_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in ACUTE_HEART_FAILURE_CONTEXT_TERMS
    )


def _has_acute_heart_failure_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_oxygen_niv = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_HF_OXYGEN_NIV_ACTION_TERMS
    )
    has_diuretic = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_HF_DIURETIC_ACTION_TERMS
    )
    has_vasodilator_or_bp_plan = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_HF_VASODILATOR_BP_ACTION_TERMS
    )
    has_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in ACUTE_HF_ESCALATION_ACTION_TERMS
    )
    return has_oxygen_niv and has_diuretic and has_vasodilator_or_bp_plan and has_escalation


def _has_acute_heart_failure_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_bp_vasodilator_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_HF_BP_VASODILATOR_SAFETY_TERMS
    )
    has_renal_electrolyte_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_HF_RENAL_ELECTROLYTE_SAFETY_TERMS
    )
    has_trigger_differential_review = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_HF_TRIGGER_DIFFERENTIAL_SAFETY_TERMS
    )
    has_shock_respiratory_failure_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in ACUTE_HF_SHOCK_RESPIRATORY_FAILURE_SAFETY_TERMS
    )
    return (
        has_bp_vasodilator_safety
        and has_renal_electrolyte_safety
        and has_trigger_differential_review
        and has_shock_respiratory_failure_safety
    )


def _requires_cardiac_tamponade_safety_check(data: dict[str, Any]) -> bool:
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
        "clinical_red_flags",
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in CARDIAC_TAMPONADE_CONTEXT_TERMS
    )


def _has_cardiac_tamponade_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_echo_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in CARDIAC_TAMPONADE_ECHO_ACTION_TERMS
    )
    has_drainage_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in CARDIAC_TAMPONADE_DRAINAGE_ACTION_TERMS
    )
    has_specialist_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in CARDIAC_TAMPONADE_SPECIALIST_ACTION_TERMS
    )
    has_hemodynamic_action = any(
        _contains_safety_term(normalized_actions, term)
        for term in CARDIAC_TAMPONADE_HEMODYNAMIC_ACTION_TERMS
    )
    return (
        has_echo_action
        and has_drainage_action
        and has_specialist_action
        and has_hemodynamic_action
    )


def _has_cardiac_tamponade_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_no_delay_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CARDIAC_TAMPONADE_NO_DELAY_SAFETY_TERMS
    )
    has_anticoag_reversal_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CARDIAC_TAMPONADE_ANTICOAG_REVERSAL_SAFETY_TERMS
    )
    has_cause_complication_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in CARDIAC_TAMPONADE_CAUSE_COMPLICATION_SAFETY_TERMS
    )
    return (
        has_no_delay_safety
        and has_anticoag_reversal_safety
        and has_cause_complication_safety
    )


def _requires_tension_pneumothorax_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in TENSION_PNEUMOTHORAX_CONTEXT_TERMS
    )


def _has_tension_pneumothorax_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_decompression = any(
        _contains_safety_term(normalized_actions, term)
        for term in TENSION_PNEUMOTHORAX_DECOMPRESSION_ACTION_TERMS
    )
    has_chest_tube = any(
        _contains_safety_term(normalized_actions, term)
        for term in TENSION_PNEUMOTHORAX_CHEST_TUBE_ACTION_TERMS
    )
    has_airway_oxygen = any(
        _contains_safety_term(normalized_actions, term)
        for term in TENSION_PNEUMOTHORAX_AIRWAY_OXYGEN_ACTION_TERMS
    )
    has_reassessment = any(
        _contains_safety_term(normalized_actions, term)
        for term in TENSION_PNEUMOTHORAX_REASSESSMENT_ACTION_TERMS
    )
    return has_decompression and has_chest_tube and has_airway_oxygen and has_reassessment


def _has_tension_pneumothorax_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_no_delay_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in TENSION_PNEUMOTHORAX_NO_DELAY_SAFETY_TERMS
    )
    has_site_technique_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in TENSION_PNEUMOTHORAX_SITE_TECHNIQUE_SAFETY_TERMS
    )
    has_recurrence_failure_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in TENSION_PNEUMOTHORAX_RECURRENCE_FAILURE_SAFETY_TERMS
    )
    has_differential_review = any(
        _contains_safety_term(normalized_checks, term)
        for term in TENSION_PNEUMOTHORAX_DIFFERENTIAL_SAFETY_TERMS
    )
    return (
        has_no_delay_safety
        and has_site_technique_safety
        and has_recurrence_failure_safety
        and has_differential_review
    )


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


def _requires_aortic_dissection_safety_check(data: dict[str, Any]) -> bool:
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
        "physical_exam",
        "initial_labs",
    ):
        risk_text = f"{risk_text} {' '.join(_nested_strings(data.get(field_name))).lower()}"
    return any(
        _contains_safety_term(risk_text, term)
        for term in AORTIC_DISSECTION_CONTEXT_TERMS
    )


def _has_aortic_dissection_time_critical_actions(actions: list[Any]) -> bool:
    normalized_actions = " ".join(str(action).lower() for action in actions)
    has_aortic_imaging = any(
        _contains_safety_term(normalized_actions, term)
        for term in AORTIC_DISSECTION_IMAGING_ACTION_TERMS
    )
    has_anti_impulse = any(
        _contains_safety_term(normalized_actions, term)
        for term in AORTIC_DISSECTION_ANTI_IMPULSE_ACTION_TERMS
    )
    has_surgical_escalation = any(
        _contains_safety_term(normalized_actions, term)
        for term in AORTIC_DISSECTION_SURGICAL_ACTION_TERMS
    )
    return has_aortic_imaging and has_anti_impulse and has_surgical_escalation


def _has_aortic_dissection_treatment_safety_check(checks: list[Any]) -> bool:
    normalized_checks = " ".join(str(check).lower() for check in checks)
    has_antithrombotic_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in AORTIC_DISSECTION_ANTITHROMBOTIC_SAFETY_TERMS
    )
    has_impulse_safety = any(
        _contains_safety_term(normalized_checks, term)
        for term in AORTIC_DISSECTION_VASODILATOR_SAFETY_TERMS
    )
    has_complication_screen = any(
        _contains_safety_term(normalized_checks, term)
        for term in AORTIC_DISSECTION_COMPLICATION_SAFETY_TERMS
    )
    return has_antithrombotic_safety and has_impulse_safety and has_complication_screen


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
