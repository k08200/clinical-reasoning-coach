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


def test_detect_patient_identifiers_finds_korean_landline_and_service_numbers():
    detected = detect_patient_identifiers(
        "보호자 연락처는 02-1234-5678이고 병원 대표번호는 0507-1234-5678입니다."
    )

    assert detected == ["phone_number"]


def test_detect_patient_identifiers_finds_direct_korean_patient_name_labels():
    detected = detect_patient_identifiers(
        "환자: 홍길동님은 흉통으로 내원했고 대상자 김영희씨도 추적 관찰 중입니다."
    )

    assert detected == ["name_identifier"]


def test_detect_patient_identifiers_finds_korean_resident_registration_numbers():
    detected = detect_patient_identifiers(
        "주민등록번호는 900101-1234567입니다. "
        "외국인등록번호 850505 5234567도 포함되어 있습니다."
    )

    assert detected == ["social_security_number"]


def test_detect_patient_identifiers_finds_korean_visit_insurance_and_messenger_ids():
    detected = detect_patient_identifiers(
        "입원번호 ADM-12345, 접수번호 R20260605, "
        "건강보험증번호 H123456789, 카카오톡 ID patient_lee로 연락했습니다."
    )

    assert detected == [
        "medical_record_number",
        "license_or_account_number",
        "messenger_handle",
    ]


def test_detect_patient_identifiers_finds_exact_visit_dates():
    detected = detect_patient_identifiers(
        "The simulated note says the visit happened on June 4, 2026 "
        "and follow-up was documented on 2026년 6월 5일."
    )

    assert detected == ["full_date"]


def test_detect_patient_identifiers_finds_exact_ages_over_89():
    detected = detect_patient_identifiers(
        "The seed says a 92-year-old patient and another patient age: 94. "
        "한국어 예시는 만 93세 환자입니다."
    )

    assert detected == ["age_over_89"]


def test_detect_patient_identifiers_finds_korean_street_addresses():
    detected = detect_patient_identifiers(
        "주소는 서울특별시 강남구 테헤란로 123입니다. "
        "거주지는 부산광역시 해운대구 우동 123-45입니다. "
        "경기도 성남시 분당구 판교역로 235로 이사했습니다."
    )

    assert detected == ["street_address"]


def test_detect_patient_identifiers_allows_older_adult_age_bucket():
    detected = detect_patient_identifiers(
        "Use a 90 or older simulated patient, or 한국어로는 90세 이상 환자라고 표기합니다."
    )

    assert detected == []


def test_detect_patient_identifiers_allows_generic_korean_location_context():
    detected = detect_patient_identifiers(
        "서울 지역 병원에서 흔한 흉통 시뮬레이션 케이스입니다. "
        "강남구 응급실 내원 상황을 교육용으로 구성합니다."
    )

    assert detected == []


def test_detect_patient_identifiers_allows_generic_korean_patient_state_context():
    detected = detect_patient_identifiers(
        "환자 상태는 안정적이고 대상자 교육은 비식별 시뮬레이션으로 진행합니다."
    )

    assert detected == []


def test_detect_patient_identifiers_allows_unlabeled_13_digit_clinical_numbers():
    detected = detect_patient_identifiers(
        "검체 바코드 예시는 1234567890123이며 교육용 더미 값입니다."
    )

    assert detected == []


def test_detect_patient_identifiers_allows_deidentified_reasoning():
    detected = detect_patient_identifiers(
        "The simulated patient is a 58-year-old man with chest pressure, "
        "diaphoresis, hypertension, and a borderline troponin."
    )

    assert detected == []
