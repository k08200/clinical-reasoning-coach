from __future__ import annotations

from app.services.privacy_guard import detect_patient_identifiers


def test_detect_patient_identifiers_finds_common_phi_patterns():
    detected = detect_patient_identifiers(
        "Patient name is John Smith, DOB 01/02/1970, MRN A123456, "
        "phone 555-123-4567, email john.smith@example.com."
    )

    assert detected == [
        "email_address",
        "phone_number",
        "medical_record_number",
        "date_of_birth",
        "full_date",
        "name_identifier",
    ]


def test_detect_patient_identifiers_finds_korean_phi_patterns():
    detected = detect_patient_identifiers(
        "환자 이름은 홍길동, 생년월일 1970-01-02, "
        "등록번호 A123456, 전화번호 010-1234-5678입니다."
    )

    assert detected == [
        "phone_number",
        "medical_record_number",
        "date_of_birth",
        "full_date",
        "name_identifier",
    ]


def test_detect_patient_identifiers_finds_exact_visit_dates():
    detected = detect_patient_identifiers(
        "The simulated note says the visit happened on June 4, 2026 "
        "and follow-up was documented on 2026년 6월 5일."
    )

    assert detected == ["full_date"]


def test_detect_patient_identifiers_allows_deidentified_reasoning():
    detected = detect_patient_identifiers(
        "The simulated patient is a 58-year-old man with chest pressure, "
        "diaphoresis, hypertension, and a borderline troponin."
    )

    assert detected == []
