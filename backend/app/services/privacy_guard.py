from __future__ import annotations

import re
from dataclasses import dataclass


PHI_SAFETY_RESPONSE = (
    "I can't process or store messages that appear to contain patient identifiers. "
    "Please remove names, contact details, record numbers, exact dates, addresses, "
    "and other identifying details, then restate the scenario as a de-identified "
    "educational simulation."
)


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
        "medical_record_number",
        re.compile(
            r"\b(?:MRN|medical record(?: number)?|chart(?: number)?|patient ID)\s*[:#-]?\s*[A-Z0-9-]{5,}\b",
            re.IGNORECASE,
        ),
    ),
    IdentifierPattern(
        "medical_record_number",
        re.compile(r"(?:등록번호|환자번호|차트번호)\s*[:#-]?\s*[A-Z0-9가-힣-]{4,}"),
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
)


def detect_patient_identifiers(text: str) -> list[str]:
    detected: list[str] = []
    seen: set[str] = set()

    for identifier in IDENTIFIER_PATTERNS:
        if identifier.pattern.search(text) and identifier.category not in seen:
            detected.append(identifier.category)
            seen.add(identifier.category)

    return detected
