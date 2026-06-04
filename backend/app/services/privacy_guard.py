from __future__ import annotations

import re
from dataclasses import dataclass


PHI_SAFETY_RESPONSE = (
    "I can't process or store messages that appear to contain patient identifiers. "
    "Please remove names, contact details, record numbers, exact dates, addresses, "
    "and other identifying details, then restate the scenario as a de-identified "
    "educational simulation."
)

KOREAN_PHI_SAFETY_RESPONSE = (
    "환자 식별자로 보이는 정보가 포함된 메시지는 처리하거나 저장할 수 없습니다. "
    "이름, 연락처, 등록/입원/접수번호, 정확한 날짜, 주소, 메신저 ID 등 식별 가능 "
    "정보를 제거한 뒤 비식별화된 교육용 시뮬레이션으로 다시 작성해 주세요."
)

HANGUL_PATTERN = re.compile(r"[가-힣]")


@dataclass(frozen=True)
class IdentifierPattern:
    category: str
    pattern: re.Pattern[str]


IDENTIFIER_PATTERNS: tuple[IdentifierPattern, ...] = (
    IdentifierPattern(
        "email_address",
        re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    ),
    IdentifierPattern(
        "phone_number",
        re.compile(
            r"(?<!\d)(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)"
        ),
    ),
    IdentifierPattern(
        "phone_number",
        re.compile(r"(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)"),
    ),
    IdentifierPattern(
        "social_security_number",
        re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    ),
    IdentifierPattern(
        "social_security_number",
        re.compile(r"(?<!\d)\d{6}-[1-8]\d{6}(?!\d)"),
    ),
    IdentifierPattern(
        "social_security_number",
        re.compile(
            r"(?:주민등록번호|주민번호|외국인등록번호|외국인번호)\s*(?:은|는|:|=)?\s*"
            r"\d{6}\s*-?\s*[1-8]\d{6}"
        ),
    ),
    IdentifierPattern(
        "medical_record_number",
        re.compile(
            r"\b(?:MRN|medical record(?: number)?|chart(?: number)?|patient ID)\s*[:#-]?\s*[A-Z0-9-]{5,}\b",
            re.IGNORECASE,
        ),
    ),
    IdentifierPattern(
        "medical_record_number",
        re.compile(
            r"(?<!주민)(?<!외국인)(?:등록번호|환자번호|차트번호)\s*[:#-]?\s*[A-Z0-9가-힣-]{4,}"
        ),
    ),
    IdentifierPattern(
        "medical_record_number",
        re.compile(
            r"(?:입원번호|외래번호|접수번호|수진자번호|병록번호|진료번호|진료카드번호)"
            r"\s*(?:은|는|:|=|#)?\s*[A-Z0-9가-힣-]{4,}"
        ),
    ),
    IdentifierPattern(
        "date_of_birth",
        re.compile(
            r"\b(?:DOB|date of birth|born)\s*[:#-]?\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Z][a-z]+ \d{1,2},? \d{4})\b",
            re.IGNORECASE,
        ),
    ),
    IdentifierPattern(
        "date_of_birth",
        re.compile(
            r"(?:생년월일|출생일)\s*[:#-]?\s*(?:\d{2,4}[./-]\d{1,2}[./-]\d{1,2}|\d{2,4}년\s*\d{1,2}월\s*\d{1,2}일)"
        ),
    ),
    IdentifierPattern(
        "full_date",
        re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"),
    ),
    IdentifierPattern(
        "full_date",
        re.compile(r"\b\d{2,4}[./-]\d{1,2}[./-]\d{1,2}\b"),
    ),
    IdentifierPattern(
        "full_date",
        re.compile(
            r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
            r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"
            r"Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b",
            re.IGNORECASE,
        ),
    ),
    IdentifierPattern(
        "full_date",
        re.compile(r"\b\d{2,4}년\s*\d{1,2}월\s*\d{1,2}일\b"),
    ),
    IdentifierPattern(
        "age_over_89",
        re.compile(
            r"\b(?:age|aged)\s*[:#-]?\s*(?:9[0-9]|1[0-2][0-9])\b"
            r"(?!\s*(?:or older|years?\s+or\s+older))",
            re.IGNORECASE,
        ),
    ),
    IdentifierPattern(
        "age_over_89",
        re.compile(
            r"\b(?:9[0-9]|1[0-2][0-9])[-\s]?(?:year[-\s]?old|yo)\b",
            re.IGNORECASE,
        ),
    ),
    IdentifierPattern(
        "age_over_89",
        re.compile(r"(?:만\s*)?(?:9[0-9]|1[0-2][0-9])\s*세(?!\s*이상)"),
    ),
    IdentifierPattern(
        "name_identifier",
        re.compile(
            r"\b(?:patient(?:'s)? name|name|called)\s+(?:is|:)?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b"
        ),
    ),
    IdentifierPattern(
        "name_identifier",
        re.compile(r"(?:환자\s*)?(?:이름|성명)\s*(?:은|는|:)?\s*[가-힣]{2,5}"),
    ),
    IdentifierPattern(
        "street_address",
        re.compile(
            r"\b\d{1,6}\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,4}\s+"
            r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl)\b",
            re.IGNORECASE,
        ),
    ),
    IdentifierPattern(
        "street_address",
        re.compile(
            r"(?:주소|주소지|거주지|사는\s*곳|자택)\s*(?:은|는|:|=)?\s*"
            r"(?:[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|도|시)\s*)?"
            r"(?:[가-힣]+(?:시|군|구)\s+)?"
            r"[가-힣0-9]+(?:로|길|동|읍|면|리)\s*\d{1,5}(?:-\d{1,5})?"
        ),
    ),
    IdentifierPattern(
        "street_address",
        re.compile(
            r"(?:[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|도)\s*)"
            r"(?:[가-힣]+(?:시|군|구)\s+){1,2}"
            r"[가-힣0-9]+(?:로|길|동|읍|면|리)\s*\d{1,5}(?:-\d{1,5})?"
        ),
    ),
    IdentifierPattern(
        "url",
        re.compile(r"\bhttps?://[^\s]+|\bwww\.[^\s]+", re.IGNORECASE),
    ),
    IdentifierPattern(
        "ip_address",
        re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    ),
    IdentifierPattern(
        "license_or_account_number",
        re.compile(
            r"\b(?:license|account|policy|certificate)(?: number)?\s*[:#-]?\s*[A-Z0-9-]{5,}\b",
            re.IGNORECASE,
        ),
    ),
    IdentifierPattern(
        "license_or_account_number",
        re.compile(
            r"(?:건강보험증번호|보험증번호|보험자번호|증권번호|계약번호)"
            r"\s*(?:은|는|:|=|#)?\s*[A-Z0-9가-힣-]{5,}"
        ),
    ),
    IdentifierPattern(
        "messenger_handle",
        re.compile(
            r"(?:카카오톡|카톡|라인|telegram|텔레그램)\s*(?:ID|아이디|계정|handle|핸들)"
            r"\s*(?:은|는|:|=|#)?\s*@?[A-Z0-9._-]{3,}",
            re.IGNORECASE,
        ),
    ),
)


def detect_patient_identifiers(text: str) -> list[str]:
    detected: list[str] = []
    seen: set[str] = set()

    for identifier in IDENTIFIER_PATTERNS:
        if identifier.pattern.search(text) and identifier.category not in seen:
            detected.append(identifier.category)
            seen.add(identifier.category)

    return detected


def privacy_safety_response_for(text: str) -> str:
    if HANGUL_PATTERN.search(text):
        return KOREAN_PHI_SAFETY_RESPONSE
    return PHI_SAFETY_RESPONSE
