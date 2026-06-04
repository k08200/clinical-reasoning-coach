"""
Socratic coaching engine.

INVARIANT: Never reveals the diagnosis. Always responds with questions.
Uses the configured LLM provider (claude / ollama / mock).
"""
from __future__ import annotations

import re
from collections.abc import AsyncGenerator
from typing import Any

from app.services.provider import StreamChunk
from app.services.provider_factory import get_provider
from app.models.case import ClinicalCase

EDUCATIONAL_SAFETY_NOTICE = (
    "Safety note: This is an educational simulation, not patient care. "
    "If this involves a real patient, urgent deterioration, or a medical emergency, "
    "stop using this simulator and follow local emergency protocols; contact the "
    "supervising clinician or emergency services immediately."
)

REAL_PATIENT_SAFETY_RESPONSE = (
    EDUCATIONAL_SAFETY_NOTICE
    + "\n\nI cannot continue coaching on a real patient or emergency scenario. "
    "Return only with a clearly simulated training case."
)

KOREAN_EDUCATIONAL_SAFETY_NOTICE = (
    "안전 안내: 이 도구는 교육용 시뮬레이션이며 실제 진료가 아닙니다. "
    "실제 환자, 급성 악화, 또는 응급 상황이라면 이 시뮬레이터 사용을 중단하고 "
    "소속 기관의 응급 프로토콜을 따르며 즉시 지도/담당 임상의 또는 119/응급의료체계에 연락하세요."
)

KOREAN_REAL_PATIENT_SAFETY_RESPONSE = (
    KOREAN_EDUCATIONAL_SAFETY_NOTICE
    + "\n\n실제 환자나 응급 상황에 대해서는 코칭을 계속할 수 없습니다. "
    "명확히 비식별화된 교육용 시뮬레이션 케이스로만 다시 시작하세요."
)

HANGUL_PATTERN = re.compile(r"[가-힣]")

REAL_PATIENT_SIGNAL_PATTERNS = [
    "actual patient",
    "real patient",
    "my patient",
    "my mom",
    "my mother",
    "my dad",
    "my father",
    "my child",
    "my baby",
    "my friend",
    "my partner",
    "my roommate",
    "my wife",
    "my husband",
    "someone here",
    "i am having",
    "i'm having",
    "right now",
    "in the er",
    "in the ed",
    "in clinic",
    "on the ward",
    "should i call 911",
    "should i go to the er",
    "should i go to the emergency",
    "is this an emergency",
    "can't breathe",
    "cannot breathe",
    "trouble breathing",
    "severe chest pain",
    "stroke symptoms",
    "unconscious",
    "collapsed",
    "not waking up",
    "seizure",
    "suicidal",
    "overdose",
    "실제 환자",
    "제 환자",
    "저희 환자",
    "우리 환자",
    "우리 엄마",
    "우리 어머니",
    "우리 아빠",
    "우리 아버지",
    "제 아이",
    "제 아기",
    "제 친구",
    "제 배우자",
    "제 룸메이트",
    "룸메이트",
    "제가 지금",
    "나는 지금",
    "응급인가요",
    "응급 상황",
    "응급실 가야",
    "119",
    "숨이 안 쉬",
    "숨을 못 쉬",
    "호흡 곤란",
    "심한 가슴",
    "가슴 통증이 심",
    "뇌졸중 증상",
    "의식이 없",
    "깨어나지",
    "쓰러졌",
    "발작",
    "자살",
    "극단적 선택",
    "과다복용",
]
REAL_PATIENT_CONTEXTUAL_SIGNAL_PATTERNS = {
    "right now",
    "in the er",
    "in the ed",
    "in clinic",
    "on the ward",
    "severe chest pain",
    "stroke symptoms",
    "unconscious",
    "collapsed",
    "not waking up",
    "seizure",
    "호흡 곤란",
    "심한 가슴",
    "가슴 통증이 심",
    "뇌졸중 증상",
    "의식이 없",
    "깨어나지",
    "쓰러졌",
    "발작",
}
SIMULATION_CONTEXT_PATTERNS = [
    "simulated patient",
    "simulated case",
    "simulation",
    "training case",
    "practice case",
    "mock patient",
    "case scenario",
    "this case",
    "the case",
    "vignette",
    "시뮬레이션",
    "모의 환자",
    "가상 환자",
    "교육용",
    "연습 케이스",
    "훈련 케이스",
    "이 케이스",
    "증례",
]
REAL_PATIENT_OVERRIDE_PATTERNS = [
    "actual patient",
    "real patient",
    "my patient",
    "my mom",
    "my mother",
    "my dad",
    "my father",
    "my child",
    "my baby",
    "my friend",
    "my partner",
    "my roommate",
    "my wife",
    "my husband",
    "someone here",
    "i am having",
    "i'm having",
    "i can't breathe",
    "i cannot breathe",
    "should i call 911",
    "should i go to the er",
    "should i go to the emergency",
    "실제 환자",
    "제 환자",
    "저희 환자",
    "우리 환자",
    "우리 엄마",
    "우리 어머니",
    "우리 아빠",
    "우리 아버지",
    "제 아이",
    "제 아기",
    "제 친구",
    "제 배우자",
    "제 룸메이트",
    "룸메이트",
    "제가 지금",
    "나는 지금",
    "119",
    "응급실 가야",
    "숨이 안 쉬",
    "숨을 못 쉬",
]
REAL_PATIENT_HIGH_CONFIDENCE_PATTERNS = [
    pattern
    for pattern in REAL_PATIENT_SIGNAL_PATTERNS
    if pattern not in REAL_PATIENT_CONTEXTUAL_SIGNAL_PATTERNS
]
REAL_PATIENT_PERSONAL_URGENCY_PATTERNS = [
    re.compile(
        r"\b(?:i|me|myself)\b.{0,48}\b(?:severe chest pain|stroke symptoms|trouble breathing|unconscious|collapsed|not waking up|seizure)\b"
    ),
    re.compile(
        r"\b(?:severe chest pain|stroke symptoms|trouble breathing|unconscious|collapsed|not waking up|seizure)\b.{0,48}\b(?:i|me|myself)\b"
    ),
    re.compile(r"(?:제가|저는|나는|내가).{0,24}(?:호흡 곤란|심한 가슴|가슴 통증이 심|뇌졸중 증상|의식이 없|깨어나지|쓰러졌|발작)"),
    re.compile(r"(?:호흡 곤란|심한 가슴|가슴 통증이 심|뇌졸중 증상|의식이 없|깨어나지|쓰러졌|발작).{0,24}(?:제가|저는|나는|내가)"),
]

DIRECT_CONFIRMATION_PATTERNS = [
    r"\byou'?re right\b",
    r"\byou are right\b",
    r"\byou'?re correct\b",
    r"\byou are correct\b",
    r"\bright track\b",
    r"\bthat is correct\b",
    r"\bthe diagnosis is\b",
    r"\bthis is (?:a |an )?\w+",
]
KOREAN_DIRECT_CONFIRMATION_PATTERNS = [
    r"맞습니다",
    r"정답입니다",
    r"맞는\s*진단",
    r"올바른\s*진단",
    r"진단은",
    r"이\s*환자는\s*.{0,20}입니다",
]

MANAGEMENT_ACTION_VERBS = (
    "activate",
    "administer",
    "admit",
    "anticoagulate",
    "bolus",
    "call",
    "check",
    "consult",
    "discharge",
    "draw",
    "give",
    "get",
    "infuse",
    "initiate",
    "intubate",
    "obtain",
    "order",
    "prescribe",
    "proceed",
    "send",
    "start",
    "transfuse",
    "treat",
)
MANAGEMENT_ACTION_PATTERN = "|".join(MANAGEMENT_ACTION_VERBS)
MANAGEMENT_TARGET_PATTERN = (
    r"alteplase|antibiotics?|anticoagulation|anticoagulants?|aspirin|"
    r"blood cultures?|blood products?|bolus|cath lab activation|cath lab|ct|ecg|ekg|"
    r"fluids?|heparin|insulin|packed rbcs?|prbcs?|pressors?|red blood cells?|"
    r"thrombolysis|transfusion|tpa|vasopressors?"
)
MANAGEMENT_TARGET_PHRASE_PATTERN = (
    rf"(?:[a-z0-9-]+\s+){{0,4}}(?:{MANAGEMENT_TARGET_PATTERN})"
)
RISKY_MANAGEMENT_TARGET_PATTERN = (
    r"alteplase|anticoagulation|anticoagulants?|antiplatelets?|aspirin|"
    r"blood products?|heparin|insulin|packed rbcs?|prbcs?|pressors?|red blood cells?|"
    r"thrombolysis|transfusion|tpa|vasopressors?"
)
PREMATURE_CLOSURE_TARGETS = {
    "discharge home": "discharge",
    "discharge": "discharge",
    "send home": "discharge",
    "go home": "discharge",
    "outpatient follow-up": "outpatient follow-up",
    "outpatient follow up": "outpatient follow-up",
    "reassure": "reassurance",
    "reassurance": "reassurance",
    "no further workup": "no further workup",
    "no further testing": "no further testing",
}
PREMATURE_CLOSURE_COMMITMENT_PATTERNS = [
    r"\b(?:i|we|you)\s+(?:will|would|should|can|could|plan to)\s+(?:discharge|send|reassure)\b",
    r"\b(?:discharge|send)\s+(?:the patient|him|her|them|home)\b",
    r"\b(?:the patient|he|she|they)\s+(?:can|could|should)\s+go home\b",
    r"\bno further (?:workup|testing)\b",
    r"\boutpatient follow[-\s]?up\b.{0,40}\b(?:is enough|is sufficient|only)\b",
]
KOREAN_RISKY_MANAGEMENT_TARGETS = {
    "알테플라제": "alteplase",
    "혈전용해": "thrombolysis",
    "tpa": "tpa",
    "항응고": "anticoagulation",
    "항혈소판": "antiplatelet",
    "아스피린": "aspirin",
    "헤파린": "heparin",
    "인슐린": "insulin",
    "승압제": "vasopressors",
    "바소프레서": "vasopressors",
    "수혈": "transfusion",
    "농축적혈구": "packed red blood cells",
    "혈액제제": "blood products",
}
KOREAN_PREMATURE_CLOSURE_TARGETS = {
    "퇴원": "discharge",
    "귀가": "discharge",
    "안심": "reassurance",
    "외래 추적": "outpatient follow-up",
    "외래추적": "outpatient follow-up",
    "추가 검사 필요 없": "no further testing",
    "추가 검사는 필요 없": "no further testing",
    "추가검사 필요 없": "no further testing",
    "추가검사는 필요 없": "no further testing",
}
KOREAN_PREMATURE_CLOSURE_COMMITMENT_PATTERNS = [
    r"(?:퇴원|귀가|안심|외래\s*추적|외래추적).{0,20}(?:하겠|시키|합니다|하면|충분|가능|됩니다)",
    r"(?:추가\s*검사|추가검사).{0,20}(?:필요\s*없)",
]
KOREAN_RISKY_MANAGEMENT_COMMITMENT_PATTERNS = [
    r"(?:시작|투여|주겠|쓰겠|사용|진행|시행|처치|치료|넣겠|올리겠|걸겠|처방)",
]
KOREAN_DIRECT_MANAGEMENT_ORDER_PATTERNS = [
    r"(?:시작|투여|사용|진행|시행|처치|치료|넣|올리|걸|처방)(?:하세요|해야|하십시오|합니다|하세요\.)?",
    r"(?:주겠|주세요|주십시오|줘야|줍니다|준다)",
    r"(?:필요합니다|필요해요|적응증입니다|권장됩니다|바로|즉시)",
]
KOREAN_MANAGEMENT_SAFETY_CHECK_PATTERNS = [
    r"확인",
    r"평가",
    r"검토",
    r"배제",
    r"금기",
    r"출혈",
    r"알레르기",
    r"대동맥\s*박리",
    r"칼륨",
    r"포타슘",
    r"신장",
    r"콩팥",
    r"혈액형",
    r"교차\s*시험",
    r"교차\s*적합",
    r"동의",
    r"수혈\s*반응",
]
KOREAN_DISPOSITION_SAFETY_CHECK_PATTERNS = [
    r"위험\s*징후",
    r"레드\s*플래그",
    r"생명\s*위협",
    r"불안정",
    r"저산소",
    r"심전도",
    r"ecg",
    r"ekg",
    r"트로포닌",
    r"연속",
    r"재내원",
]
KOREAN_MANAGEMENT_SAFETY_BYPASS_PATTERNS = [
    r"(?:확인|평가|검토|배제|금기|출혈|알레르기|대동맥\s*박리|칼륨|포타슘|신장|콩팥|혈액형|교차\s*시험|교차\s*적합|동의|수혈\s*반응).{0,40}(?:없이|안\s*하고|하지\s*않고|필요\s*없)",
    r"(?:없이|안\s*하고|하지\s*않고|필요\s*없).{0,40}(?:확인|평가|검토|배제|금기|출혈|알레르기|대동맥\s*박리|칼륨|포타슘|신장|콩팥|혈액형|교차\s*시험|교차\s*적합|동의|수혈\s*반응)",
]
DIRECT_MANAGEMENT_PATTERNS = [
    rf"^\s*(?:{MANAGEMENT_ACTION_PATTERN})\b",
    rf"\b(?:you|we)\s+(?:should|need to|must|have to)\s+(?:{MANAGEMENT_ACTION_PATTERN})\b",
    rf"\b(?:the )?next step (?:is|would be)\s+to\s+(?:{MANAGEMENT_ACTION_PATTERN})\b",
    rf"\bi (?:recommend|would)\s+(?:{MANAGEMENT_ACTION_PATTERN})\b",
    rf"\b(?:proceed with|go ahead and|move to)\s+(?:{MANAGEMENT_TARGET_PHRASE_PATTERN})\b",
    rf"\b(?:this patient|the patient)\s+(?:needs|requires)\s+(?:{MANAGEMENT_TARGET_PHRASE_PATTERN})\b",
    rf"\b(?:this patient|the patient)\s+should\s+(?:receive|get)\s+(?:{MANAGEMENT_TARGET_PHRASE_PATTERN})\b",
    rf"\b(?:{MANAGEMENT_TARGET_PHRASE_PATTERN})\s+(?:is|are)\s+(?:indicated|warranted|required|needed)\b",
    rf"\b(?:{MANAGEMENT_TARGET_PHRASE_PATTERN})\s+should\s+be\s+(?:given|administered|started|initiated|ordered|obtained)\b",
    rf"\b(?:treat|manage)\s+with\s+(?:{MANAGEMENT_TARGET_PHRASE_PATTERN})\b",
]
RISKY_DIRECT_MANAGEMENT_PATTERNS = [
    rf"^\s*(?:{MANAGEMENT_ACTION_PATTERN})\b.*\b(?:{RISKY_MANAGEMENT_TARGET_PATTERN})\b",
    rf"\b(?:i|we|you)\s+(?:will|would|should|need to|must|have to)\s+(?:{MANAGEMENT_ACTION_PATTERN})\b.*\b(?:{RISKY_MANAGEMENT_TARGET_PATTERN})\b",
    rf"\b(?:start|give|administer|initiate|proceed with|treat with|manage with)\b.*\b(?:{RISKY_MANAGEMENT_TARGET_PATTERN})\b",
]
MANAGEMENT_SAFETY_CHECK_PATTERNS = [
    r"\b(?:after|before)\s+(?:checking|ruling out|assessing)\b",
    r"\bcontraindications?\b",
    r"\ballerg(?:y|ies)\b",
    r"\bbleed(?:ing)?\b",
    r"\bblood type\b",
    r"\baortic dissection\b",
    r"\bconsent\b",
    r"\bcross-?match\b",
    r"\bpotassium\b",
    r"\brenal\b",
    r"\bkidney\b",
    r"\btype and screen\b",
    r"\btransfusion reaction\b",
]
DISPOSITION_SAFETY_CHECK_PATTERNS = [
    r"\bred flags?\b",
    r"\blife[-\s]?threatening\b",
    r"\bdangerous alternatives?\b",
    r"\bunstable\b",
    r"\binstability\b",
    r"\bhypoxi(?:a|c)\b",
    r"\becg\b",
    r"\bekg\b",
    r"\btroponin\b",
    r"\bserial\b",
    r"\breturn precautions?\b",
    r"\bfollow[-\s]?up plan\b",
]
MANAGEMENT_SAFETY_BYPASS_PATTERNS = [
    r"\b(?:no need|without|skip|don'?t need|do not need|not necessary)\b.{0,80}\b(?:check|rule out|contraindications?|allerg(?:y|ies)|bleed(?:ing)?|aortic dissection|blood type|consent|cross-?match|potassium|renal|kidney|type and screen|transfusion reaction)\b",
    r"\b(?:check|rule out|contraindications?|allerg(?:y|ies)|bleed(?:ing)?|aortic dissection|blood type|consent|cross-?match|potassium|renal|kidney|type and screen|transfusion reaction)\b.{0,80}\b(?:no need|without|skip|don'?t need|do not need|not necessary)\b",
]

DIAGNOSIS_LEAK_TERMS = {
    "acute coronary syndrome": ["acute coronary syndrome", "acs"],
    "myocardial infarction": ["myocardial infarction", "heart attack", "mi"],
    "stemi": [
        "stemi",
        "st elevation",
        "st-elevation",
        "myocardial infarction",
        "heart attack",
        "mi",
        "acute coronary syndrome",
        "acs",
    ],
    "nstemi": ["nstemi", "non st elevation", "non-st elevation", "myocardial infarction", "mi"],
    "septic": ["septic shock", "urosepsis", "sepsis"],
    "pulmonary embolism": ["pulmonary embolism", "embolism", "pe"],
    "diabetic ketoacidosis": ["diabetic ketoacidosis", "ketoacidosis", "dka"],
    "ischemic stroke": ["ischemic stroke", "cardioembolic stroke", "stroke"],
}
DIAGNOSIS_LEAK_STOPWORDS = {
    "acute",
    "and",
    "associated",
    "chronic",
    "due",
    "from",
    "likely",
    "mild",
    "moderate",
    "secondary",
    "severe",
    "suspected",
    "the",
    "to",
    "type",
    "with",
    "without",
}

SAFE_GUARDRAIL_RESPONSE = (
    "Let's keep this as a reasoning exercise. What findings make this presentation "
    "time-sensitive, what dangerous alternatives must be ruled out, and what safety "
    "checks would you complete before management?"
)

MANAGEMENT_SAFETY_REDIRECT_RESPONSE = (
    "Pause the management plan for this simulated case. Before giving treatment "
    "or choosing disposition, what contraindications or safety checks could make "
    "that plan unsafe, what red flags or time-critical actions must be addressed, "
    "and what finding would change your next step?"
)


def _format_list(items: list[str] | None) -> str:
    return ", ".join(items or []) or "None documented"


def _format_sources(sources: list[dict] | None) -> str:
    if not sources:
        return "None documented"
    return "; ".join(
        f"{source.get('title', 'Untitled source')} ({source.get('url', 'no URL')})"
        for source in sources
    )


def _normalize_for_guardrail(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _diagnosis_leak_terms(case: ClinicalCase) -> list[str]:
    diagnosis = _normalize_for_guardrail(case.diagnosis)
    terms: list[str] = []
    for trigger, candidates in DIAGNOSIS_LEAK_TERMS.items():
        if trigger in diagnosis:
            terms.extend(candidates)
    terms.extend(_generic_diagnosis_leak_terms(diagnosis))
    return sorted(set(terms), key=len, reverse=True)


def _generic_diagnosis_leak_terms(diagnosis: str) -> list[str]:
    raw_tokens = re.findall(r"[a-z0-9]+", diagnosis)
    tokens = [
        token
        for token in raw_tokens
        if token not in DIAGNOSIS_LEAK_STOPWORDS
    ]
    terms: set[str] = set()
    acronym = "".join(token[0] for token in raw_tokens if token not in {"and", "or", "of", "the"})
    if 3 <= len(acronym) <= 6 or acronym in {"mi", "pe"}:
        terms.add(acronym)
    for size in (3, 2):
        for index in range(0, max(0, len(tokens) - size + 1)):
            phrase_tokens = tokens[index:index + size]
            if any(len(token) >= 4 for token in phrase_tokens):
                terms.add(" ".join(phrase_tokens))
    for token in tokens:
        if len(token) >= 5 or token in {"acs", "copd", "dka", "nstemi", "stemi"}:
            terms.add(token)
    return list(terms)


def _contains_diagnosis_leak(case: ClinicalCase, text: str) -> bool:
    normalized = _normalize_for_guardrail(text)
    for term in _diagnosis_leak_terms(case):
        if re.search(rf"\b{re.escape(term)}\b", normalized):
            return True
    return False


def _contains_direct_confirmation(text: str) -> bool:
    normalized = _normalize_for_guardrail(text)
    return any(
        re.search(pattern, normalized)
        for pattern in DIRECT_CONFIRMATION_PATTERNS
    ) or any(
        re.search(pattern, text)
        for pattern in KOREAN_DIRECT_CONFIRMATION_PATTERNS
    )


def _contains_direct_management_order(text: str) -> bool:
    normalized_sentences = [
        _normalize_for_guardrail(sentence)
        for sentence in re.split(r"[.!?\n]+", text)
        if sentence.strip()
    ]
    return any(
        re.search(pattern, sentence)
        for sentence in normalized_sentences
        for pattern in DIRECT_MANAGEMENT_PATTERNS
    ) or _contains_korean_direct_management_order(text)


def _contains_premature_closure_directive(text: str) -> bool:
    normalized_sentences = [
        _normalize_for_guardrail(sentence)
        for sentence in re.split(r"[.!?\n]+", text)
        if sentence.strip()
    ]
    return any(
        _premature_closure_terms(sentence)
        for sentence in normalized_sentences
    )


def _contains_korean_direct_management_order(text: str) -> bool:
    if not HANGUL_PATTERN.search(text):
        return False
    normalized = _normalize_for_guardrail(text)
    if "?" in text or "까요" in normalized:
        return False
    has_target = any(
        phrase.lower() in normalized
        for phrase in KOREAN_RISKY_MANAGEMENT_TARGETS
    )
    if not has_target:
        return False
    return any(
        re.search(pattern, normalized)
        for pattern in KOREAN_DIRECT_MANAGEMENT_ORDER_PATTERNS
    )


def detect_management_safety_gap(
    student_message: str,
    uncovered_safety_targets: dict[str, list[str]] | None,
) -> list[str]:
    uncovered_targets = uncovered_safety_targets or {}
    uncovered_checks = uncovered_targets.get("contraindication_checks") or []
    uncovered_disposition_safety = (
        (uncovered_targets.get("red_flags") or [])
        + (uncovered_targets.get("time_critical_actions") or [])
    )

    normalized = _normalize_for_guardrail(student_message)
    premature_closure_terms = _premature_closure_terms(normalized)
    if (
        premature_closure_terms
        and uncovered_disposition_safety
        and not _mentions_disposition_safety_check(normalized)
    ):
        return premature_closure_terms

    if not uncovered_checks:
        return []

    risky_terms = _risky_management_terms(normalized)
    if not risky_terms:
        return []

    has_risky_commitment = _has_risky_management_commitment(normalized)
    if not has_risky_commitment:
        return []

    bypasses_safety_check = _bypasses_management_safety_check(normalized)
    mentions_safety_check = _mentions_management_safety_check(normalized)
    if mentions_safety_check and not bypasses_safety_check:
        return []

    return risky_terms


def _premature_closure_terms(normalized: str) -> list[str]:
    if not _has_premature_closure_commitment(normalized):
        return []
    terms = {
        canonical
        for phrase, canonical in PREMATURE_CLOSURE_TARGETS.items()
        if phrase in normalized
    }
    for phrase, canonical in KOREAN_PREMATURE_CLOSURE_TARGETS.items():
        if phrase.lower() in normalized:
            terms.add(canonical)
    return sorted(terms)


def _has_premature_closure_commitment(normalized: str) -> bool:
    return any(
        re.search(pattern, normalized)
        for pattern in PREMATURE_CLOSURE_COMMITMENT_PATTERNS
    ) or any(
        re.search(pattern, normalized)
        for pattern in KOREAN_PREMATURE_CLOSURE_COMMITMENT_PATTERNS
    )


def _risky_management_terms(normalized: str) -> list[str]:
    terms = set(re.findall(rf"\b(?:{RISKY_MANAGEMENT_TARGET_PATTERN})\b", normalized))
    for phrase, canonical in KOREAN_RISKY_MANAGEMENT_TARGETS.items():
        if phrase.lower() in normalized:
            terms.add(canonical)
    return sorted(terms, key=len, reverse=True)


def _has_risky_management_commitment(normalized: str) -> bool:
    if any(re.search(pattern, normalized) for pattern in RISKY_DIRECT_MANAGEMENT_PATTERNS):
        return True
    has_korean_target = any(
        phrase.lower() in normalized
        for phrase in KOREAN_RISKY_MANAGEMENT_TARGETS
    )
    if not has_korean_target:
        return False
    return any(
        re.search(pattern, normalized)
        for pattern in KOREAN_RISKY_MANAGEMENT_COMMITMENT_PATTERNS
    )


def _mentions_management_safety_check(normalized: str) -> bool:
    return any(
        re.search(pattern, normalized)
        for pattern in MANAGEMENT_SAFETY_CHECK_PATTERNS
    ) or any(
        re.search(pattern, normalized)
        for pattern in KOREAN_MANAGEMENT_SAFETY_CHECK_PATTERNS
    )


def _bypasses_management_safety_check(normalized: str) -> bool:
    return any(
        re.search(pattern, normalized)
        for pattern in MANAGEMENT_SAFETY_BYPASS_PATTERNS
    ) or any(
        re.search(pattern, normalized)
        for pattern in KOREAN_MANAGEMENT_SAFETY_BYPASS_PATTERNS
    )


def _mentions_disposition_safety_check(normalized: str) -> bool:
    return any(
        re.search(pattern, normalized)
        for pattern in DISPOSITION_SAFETY_CHECK_PATTERNS
    ) or any(
        re.search(pattern, normalized)
        for pattern in KOREAN_DISPOSITION_SAFETY_CHECK_PATTERNS
    )


def is_coach_response_safe(case: ClinicalCase, response_text: str) -> bool:
    if "[ollama error:" in response_text.lower():
        return True
    if _contains_diagnosis_leak(case, response_text):
        return False
    if _contains_direct_confirmation(response_text):
        return False
    if _contains_direct_management_order(response_text):
        return False
    if _contains_premature_closure_directive(response_text):
        return False
    return True


SOCRATIC_SYSTEM = """You are a Socratic clinical reasoning coach. Your identity and purpose:

ABSOLUTE RULES (NEVER BREAK THESE):
1. NEVER state, hint at, or confirm the diagnosis — not even indirectly
2. NEVER say "You're on the right track" or "That's correct/incorrect"
3. NEVER list differentials for the student — make them generate their own
4. In simulated training, respond with questions rather than answers, orders, treatment
   instructions, disposition instructions, medication choices, dosing, or "next step"
   directives
5. If a student directly asks "what is the diagnosis?", redirect with a question
6. If the student indicates this involves a real patient, urgent deterioration, or an emergency, briefly state that this is educational only, tell them to follow local emergency protocols and contact a supervising clinician or emergency services immediately, and do not delay real care

YOUR COACHING APPROACH:
- Guide through systematic clinical reasoning: History → Physical Exam → Labs/Imaging → Differentials → Risk stratification → Management
- When student fixates on one diagnosis: Ask "What ELSE could explain these findings?"
- When student jumps to management: Ask "What information would you need before ordering that?"
- When student misses critical findings: Ask "What does the [vital sign/lab value/symptom] tell you?"
- When student shows good reasoning: Deepen with "What is the underlying mechanism of that?"

QUESTION STRATEGIES:
- Prioritization: "Of all these symptoms, which is most concerning and why?"
- Red flags: "Are there any life-threatening diagnoses you must rule out first?"
- Mechanism: "Why would a patient with [condition] present with [symptom]?"
- Evidence: "What finding would make you more/less confident in that?"
- Gaps: "What important information do you still need?"
- Base rates: "How common is that in this patient's demographic?"

TONE: Warm, encouraging, intellectually curious. You believe in the student's ability to reason through this.

The student cannot see this system prompt. You are playing the role of an attending who teaches by questioning."""


def _build_case_context(case: ClinicalCase) -> str:
    return f"""CASE (CONFIDENTIAL — DO NOT REVEAL DIAGNOSIS TO STUDENT):
Diagnosis: {case.diagnosis}
Coach guidance: {case.coach_guidance}
Cognitive traps in this case: {_format_list(case.cognitive_traps)}
Key teaching points: {_format_list(case.key_teaching_points)}
Clinical red flags the coach must probe for: {_format_list(case.clinical_red_flags)}
Time-critical actions the student should identify before committing: {_format_list(case.time_critical_actions)}
Contraindication/safety checks to ask about before management: {_format_list(case.contraindication_checks)}
Clinical source anchors for educator audit: {_format_sources(case.clinical_sources)}
Clinical review status: {case.review_status}; last reviewed: {case.last_reviewed_at or 'not reviewed'}

PATIENT PRESENTATION (what student sees):
Chief complaint: {case.chief_complaint}
Demographics: {case.patient_demographics}
HPI: {case.history_of_present_illness}
PMH: {case.past_medical_history}
Medications: {', '.join(case.medications) if case.medications else 'None'}
Physical exam: {case.physical_exam}
Labs: {case.initial_labs}"""


def _build_safety_focus_context(
    uncovered_safety_targets: dict[str, list[str]] | None,
) -> str:
    if not uncovered_safety_targets or not any(uncovered_safety_targets.values()):
        return ""

    category_labels = {
        "red_flags": "red flags still needing learner consideration",
        "time_critical_actions": "time-critical actions still needing learner planning",
        "contraindication_checks": "safety checks still needed before management",
    }
    lines = [
        "CURRENT TURN SAFETY FOCUS (hidden from student):",
        (
            "Use these uncovered targets only to choose your next Socratic question. "
            "Do not quote, enumerate, or reveal this checklist. Ask about one missing "
            "safety area at a time and make the learner reason it out."
        ),
    ]
    for category, label in category_labels.items():
        items = uncovered_safety_targets.get(category) or []
        if items:
            lines.append(f"- {label}: {_format_list(items)}")
    return "\n".join(lines)


def _build_opening_message(case: ClinicalCase) -> str:
    demographics = case.patient_demographics
    age = demographics.get("age", "unknown")
    sex = demographics.get("sex", "patient")
    vitals = case.physical_exam.get("vitals", {})
    patient_label = (
        f"{age}-year-old {sex}" if isinstance(age, int) else f"{age} {sex}"
    )

    return f"""Let me present you with a case.

**Chief Complaint:** {case.chief_complaint}

**Patient:** {patient_label}

**History of Present Illness:** {case.history_of_present_illness}

**Past Medical History:** {case.past_medical_history}

**Medications:** {', '.join(case.medications) if case.medications else 'None'}

**Physical Examination:**
- BP: {vitals.get('bp', 'N/A')}, HR: {vitals.get('hr', 'N/A')}, RR: {vitals.get('rr', 'N/A')}, Temp: {vitals.get('temp_c', 'N/A')}°C, SpO2: {vitals.get('spo2', 'N/A')}%
- General: {case.physical_exam.get('general', 'N/A')}
- Cardiovascular: {case.physical_exam.get('cardiovascular', 'N/A')}
- Pulmonary: {case.physical_exam.get('pulmonary', 'N/A')}
- Abdomen: {case.physical_exam.get('abdomen', 'N/A')}
- Neuro: {case.physical_exam.get('neuro', 'N/A')}

**Initial Labs:** {case.initial_labs}

---

{EDUCATIONAL_SAFETY_NOTICE}

Before we go further — what are your initial thoughts? What findings stand out to you, and what questions do you have?"""


def should_emit_real_patient_safety_notice(student_message: str) -> bool:
    return bool(detect_real_patient_signals(student_message))


def real_patient_safety_response_for(student_message: str) -> str:
    if HANGUL_PATTERN.search(student_message):
        return KOREAN_REAL_PATIENT_SAFETY_RESPONSE
    return REAL_PATIENT_SAFETY_RESPONSE


def detect_real_patient_signals(student_message: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", student_message.lower()).strip()
    detected = [
        pattern
        for pattern in REAL_PATIENT_SIGNAL_PATTERNS
        if pattern in normalized
    ]
    if not detected:
        return []

    has_simulation_context = any(
        pattern in normalized
        for pattern in SIMULATION_CONTEXT_PATTERNS
    )
    has_real_patient_override = any(
        pattern in normalized
        for pattern in REAL_PATIENT_OVERRIDE_PATTERNS
    )
    if has_simulation_context and not has_real_patient_override:
        return []

    has_high_confidence_signal = any(
        pattern in normalized
        for pattern in REAL_PATIENT_HIGH_CONFIDENCE_PATTERNS
    )
    has_personal_urgent_context = any(
        pattern.search(normalized)
        for pattern in REAL_PATIENT_PERSONAL_URGENCY_PATTERNS
    )
    if not has_high_confidence_signal and not has_personal_urgent_context:
        return []

    return detected


async def stream_coach_response(
    case: ClinicalCase,
    conversation_history: list[dict[str, Any]],
    student_message: str,
    turn_number: int,
    uncovered_safety_targets: dict[str, list[str]] | None = None,
) -> AsyncGenerator[StreamChunk, None]:
    case_context = _build_case_context(case)
    safety_focus_context = _build_safety_focus_context(uncovered_safety_targets)
    full_system = "\n\n".join(
        section for section in [SOCRATIC_SYSTEM, case_context, safety_focus_context] if section
    )

    messages = list(conversation_history)
    messages.append({"role": "user", "content": student_message})

    if should_emit_real_patient_safety_notice(student_message):
        yield StreamChunk(
            type="text_delta",
            content=real_patient_safety_response_for(student_message),
        )
        yield StreamChunk(type="done")
        return

    provider = get_provider()
    response_text: list[str] = []
    done_seen = False
    async for chunk in provider.stream(
        messages=messages,
        system=full_system,
        operation="socratic_turn",
    ):
        if chunk.type == "text_delta":
            response_text.append(chunk.content)
            continue
        if chunk.type == "done":
            done_seen = True
            full_response = "".join(response_text)
            if full_response:
                safe_response = (
                    full_response
                    if is_coach_response_safe(case, full_response)
                    else SAFE_GUARDRAIL_RESPONSE
                )
                yield StreamChunk(type="text_delta", content=safe_response)
            yield chunk
            continue
        yield chunk

    if response_text and not done_seen:
        full_response = "".join(response_text)
        safe_response = (
            full_response
            if is_coach_response_safe(case, full_response)
            else SAFE_GUARDRAIL_RESPONSE
        )
        yield StreamChunk(type="text_delta", content=safe_response)


def get_opening_message(case: ClinicalCase) -> str:
    return _build_opening_message(case)
