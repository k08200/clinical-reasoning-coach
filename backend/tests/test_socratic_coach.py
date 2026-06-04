"""Tests for Socratic coach — verifies it never gives direct answers."""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from app.services.provider import StreamChunk
from app.services.socratic_coach import (
    EDUCATIONAL_SAFETY_NOTICE,
    KOREAN_REAL_PATIENT_SAFETY_RESPONSE,
    MANAGEMENT_SAFETY_REDIRECT_RESPONSE,
    REAL_PATIENT_SAFETY_RESPONSE,
    SAFE_GUARDRAIL_RESPONSE,
    SOCRATIC_SYSTEM,
    _build_safety_focus_context,
    _build_case_context,
    get_opening_message,
    detect_management_safety_gap,
    is_coach_response_safe,
    real_patient_safety_response_for,
    should_emit_real_patient_safety_notice,
    stream_coach_response,
)


def make_mock_case():
    case = MagicMock()
    case.diagnosis = "STEMI"
    case.coach_guidance = "Guide student to ECG and troponin"
    case.cognitive_traps = ["anchoring on GERD", "missing PE"]
    case.key_teaching_points = ["Always get ECG for chest pain", "Time is muscle"]
    case.clinical_red_flags = ["Diaphoresis with crushing chest pain"]
    case.time_critical_actions = ["12-lead ECG within 10 minutes"]
    case.contraindication_checks = ["Aortic dissection features before anticoagulation"]
    case.clinical_sources = [
        {
            "title": "Chest pain guideline",
            "organization": "Test Society",
            "url": "https://example.test/chest-pain",
            "supports": ["ECG timing"],
        }
    ]
    case.review_status = "educational_draft"
    case.last_reviewed_at = "2026-06-01"
    case.chief_complaint = "Chest pain"
    case.patient_demographics = {"age": 58, "sex": "male"}
    case.history_of_present_illness = "58yo male with acute chest pain and diaphoresis"
    case.past_medical_history = "Hypertension, hyperlipidemia"
    case.medications = ["lisinopril", "atorvastatin"]
    case.physical_exam = {
        "vitals": {"bp": "150/90", "hr": 95, "rr": 18, "temp_c": 37.0, "spo2": 96},
        "general": "Diaphoretic, distressed",
        "cardiovascular": "Regular rate, no murmurs",
        "pulmonary": "Clear to auscultation",
        "abdomen": "Soft, non-tender",
        "neuro": "Alert and oriented",
    }
    case.initial_labs = {"troponin": "0.02 (borderline)", "wbc": "11.2"}
    return case


def test_opening_message_contains_case_info():
    case = make_mock_case()
    msg = get_opening_message(case)
    assert "58" in msg
    assert "male" in msg
    assert "Chest pain" in msg
    assert "lisinopril" in msg
    assert EDUCATIONAL_SAFETY_NOTICE in msg


def test_opening_message_handles_older_adult_age_bucket():
    case = make_mock_case()
    case.patient_demographics = {"age": "90 or older", "sex": "female"}

    msg = get_opening_message(case)

    assert "**Patient:** 90 or older female" in msg
    assert "90 or older-year-old" not in msg


def test_opening_message_does_not_reveal_diagnosis():
    case = make_mock_case()
    msg = get_opening_message(case)
    # Should never mention the diagnosis
    assert "STEMI" not in msg
    assert "ST elevation" not in msg


def test_case_context_includes_hidden_safety_metadata():
    context = _build_case_context(make_mock_case())

    assert "Diaphoresis with crushing chest pain" in context
    assert "12-lead ECG within 10 minutes" in context
    assert "Aortic dissection features before anticoagulation" in context
    assert "Chest pain guideline" in context
    assert "educational_draft" in context


def test_safety_focus_context_only_lists_uncovered_targets():
    context = _build_safety_focus_context({
        "red_flags": [],
        "time_critical_actions": ["12-lead ECG within 10 minutes"],
        "contraindication_checks": ["Aortic dissection features before anticoagulation"],
    })

    assert "CURRENT TURN SAFETY FOCUS" in context
    assert "time-critical actions still needing learner planning" in context
    assert "safety checks still needed before management" in context
    assert "12-lead ECG within 10 minutes" in context
    assert "Aortic dissection features before anticoagulation" in context
    assert "red flags still needing learner consideration" not in context
    assert _build_safety_focus_context({
        "red_flags": [],
        "time_critical_actions": [],
        "contraindication_checks": [],
    }) == ""


def test_socratic_system_prompt_contains_rules():
    """Verify the system prompt enforces Socratic method."""
    assert "NEVER state" in SOCRATIC_SYSTEM
    assert "respond with questions" in SOCRATIC_SYSTEM
    assert "real patient" in SOCRATIC_SYSTEM
    assert "emergency services" in SOCRATIC_SYSTEM
    assert "diagnosis" in SOCRATIC_SYSTEM.lower()


def test_socratic_system_prompt_lists_biases():
    """Verify cognitive bias guidance is in the prompt."""
    # Prompt addresses bias via behavioral guidance (fixation, base rates)
    assert "fixates" in SOCRATIC_SYSTEM or "fixat" in SOCRATIC_SYSTEM
    assert "base rates" in SOCRATIC_SYSTEM.lower() or "alternative" in SOCRATIC_SYSTEM.lower()


def test_real_patient_safety_notice_detection():
    assert should_emit_real_patient_safety_notice("My patient is getting worse right now")
    assert should_emit_real_patient_safety_notice("Is this an emergency?")
    assert should_emit_real_patient_safety_notice("I can't breathe and have severe chest pain")
    assert should_emit_real_patient_safety_notice("I have severe chest pain right now.")
    assert should_emit_real_patient_safety_notice("My friend just collapsed and is not waking up.")
    assert should_emit_real_patient_safety_notice("Someone here is unconscious after a seizure.")
    assert not should_emit_real_patient_safety_notice("The simulated patient has chest pain")
    assert not should_emit_real_patient_safety_notice(
        "The simulated patient had a seizure and is not waking up in this case."
    )
    assert not should_emit_real_patient_safety_notice(
        "In this simulated case, the patient has severe chest pain right now."
    )
    assert not should_emit_real_patient_safety_notice(
        "For this training case, the patient is in the ER and has stroke symptoms."
    )
    assert not should_emit_real_patient_safety_notice(
        "Right now I think the most dangerous alternatives should stay on the differential."
    )
    assert not should_emit_real_patient_safety_notice(
        "The patient is in clinic with severe chest pain in this educational discussion."
    )
    assert should_emit_real_patient_safety_notice(
        "This is a simulation, but my patient is deteriorating right now."
    )
    assert should_emit_real_patient_safety_notice(
        "My patient in clinic has severe chest pain right now."
    )
    assert should_emit_real_patient_safety_notice(
        "제 환자가 지금 숨을 못 쉬고 심한 가슴 통증이 있습니다."
    )
    assert should_emit_real_patient_safety_notice(
        "제 친구가 방금 쓰러졌고 의식이 없습니다."
    )
    assert should_emit_real_patient_safety_notice(
        "제가 심한 가슴 통증이 있습니다."
    )
    assert should_emit_real_patient_safety_notice(
        "응급실 가야 하나요? 119를 불러야 할까요?"
    )
    assert not should_emit_real_patient_safety_notice(
        "이 시뮬레이션 케이스에서 환자가 지금 심한 가슴 통증을 호소합니다."
    )
    assert not should_emit_real_patient_safety_notice(
        "교육용 증례에서 뇌졸중 증상을 보이는 환자를 평가하겠습니다."
    )
    assert not should_emit_real_patient_safety_notice(
        "교육용 증례에서 환자가 발작 후 의식이 없는 상황을 평가하겠습니다."
    )
    assert should_emit_real_patient_safety_notice(
        "시뮬레이션이 아니라 실제 환자가 지금 호흡 곤란이 있습니다."
    )


def test_real_patient_safety_response_matches_message_language():
    assert (
        real_patient_safety_response_for("제 환자가 지금 숨을 못 쉬고 있습니다.")
        == KOREAN_REAL_PATIENT_SAFETY_RESPONSE
    )
    assert "119" in KOREAN_REAL_PATIENT_SAFETY_RESPONSE
    assert "교육용 시뮬레이션" in KOREAN_REAL_PATIENT_SAFETY_RESPONSE
    assert (
        real_patient_safety_response_for("My patient is deteriorating right now")
        == REAL_PATIENT_SAFETY_RESPONSE
    )


def test_management_safety_gap_detection_requires_missing_contraindication_checks():
    uncovered = {
        "red_flags": [],
        "time_critical_actions": [],
        "contraindication_checks": [
            "Aortic dissection features before anticoagulation",
            "Major bleeding risk before antiplatelet therapy",
        ],
    }

    assert detect_management_safety_gap(
        "I would start heparin now.",
        uncovered,
    ) == ["heparin"]
    assert detect_management_safety_gap(
        "Give aspirin without checking bleeding risk.",
        uncovered,
    ) == ["aspirin"]
    assert detect_management_safety_gap(
        "I would start heparin after checking for aortic dissection.",
        uncovered,
    ) == []
    assert detect_management_safety_gap(
        "헤파린을 바로 시작하겠습니다.",
        uncovered,
    ) == ["heparin"]
    assert detect_management_safety_gap(
        "출혈 위험 확인 없이 아스피린을 투여하겠습니다.",
        uncovered,
    ) == ["aspirin"]
    assert detect_management_safety_gap(
        "대동맥 박리 소견과 출혈 위험을 확인한 뒤 헤파린을 시작하겠습니다.",
        uncovered,
    ) == []
    assert detect_management_safety_gap(
        "I would transfuse packed RBCs now.",
        uncovered,
    ) == ["packed rbcs"]
    assert detect_management_safety_gap(
        "Give blood products without type and screen.",
        uncovered,
    ) == ["blood products"]
    assert detect_management_safety_gap(
        "I would transfuse after crossmatch and consent.",
        uncovered,
    ) == []
    assert detect_management_safety_gap(
        "수혈을 바로 시작하겠습니다.",
        uncovered,
    ) == ["transfusion"]
    assert detect_management_safety_gap(
        "혈액형 확인 없이 농축적혈구를 투여하겠습니다.",
        uncovered,
    ) == ["packed red blood cells"]
    assert detect_management_safety_gap(
        "혈액형과 교차시험 확인 후 수혈을 진행하겠습니다.",
        uncovered,
    ) == []
    assert detect_management_safety_gap(
        "I would order an ECG now.",
        uncovered,
    ) == []
    assert detect_management_safety_gap(
        "I would start heparin now.",
        {"red_flags": [], "time_critical_actions": [], "contraindication_checks": []},
    ) == []


def test_management_safety_gap_detects_premature_disposition_before_red_flags():
    uncovered = {
        "red_flags": [
            "Diaphoresis with crushing chest pain",
            "Hypoxia or hemodynamic instability",
        ],
        "time_critical_actions": [
            "12-lead ECG within 10 minutes",
            "Serial troponin trend",
        ],
        "contraindication_checks": [],
    }

    assert detect_management_safety_gap(
        "I would discharge him home now with outpatient follow-up.",
        uncovered,
    ) == ["discharge", "outpatient follow-up"]
    assert detect_management_safety_gap(
        "No further testing is needed; I would reassure the patient.",
        uncovered,
    ) == ["no further testing", "reassurance"]
    assert detect_management_safety_gap(
        "퇴원시키고 외래 추적하면 충분합니다.",
        uncovered,
    ) == ["discharge", "outpatient follow-up"]
    assert detect_management_safety_gap(
        "위험 징후와 심전도, 연속 트로포닌을 확인한 뒤 퇴원 가능 여부를 판단하겠습니다.",
        uncovered,
    ) == []
    assert detect_management_safety_gap(
        "What criteria would make discharge safe later?",
        uncovered,
    ) == []
    assert detect_management_safety_gap(
        "After ECG, serial troponin, and no red flags, outpatient follow-up may be reasonable.",
        uncovered,
    ) == []


def test_coach_response_guardrail_detects_unsafe_clinical_content():
    case = make_mock_case()

    assert is_coach_response_safe(case, "What finding would most change your differential?")
    assert not is_coach_response_safe(case, "This is STEMI.")
    assert not is_coach_response_safe(case, "You're on the right track.")
    assert not is_coach_response_safe(case, "You should give aspirin now.")
    assert not is_coach_response_safe(case, "맞습니다. 진단은 STEMI입니다.")


def test_coach_response_guardrail_blocks_dynamic_diagnosis_terms():
    case = make_mock_case()
    case.diagnosis = "Acute appendicitis"

    assert not is_coach_response_safe(
        case,
        "The most likely explanation is appendicitis.",
    )
    assert not is_coach_response_safe(
        case,
        "What would make appendicitis less likely in this simulated case?",
    )
    assert is_coach_response_safe(
        case,
        "What finding would most change your differential?",
    )
    assert is_coach_response_safe(
        case,
        "What would make you ask about alcohol-associated causes?",
    )


def test_coach_response_guardrail_blocks_common_diagnosis_acronyms():
    case = make_mock_case()
    case.diagnosis = "Acute coronary syndrome"

    assert not is_coach_response_safe(
        case,
        "ACS should be your leading concern here.",
    )
    assert not is_coach_response_safe(
        case,
        "What findings would make acute coronary syndrome less likely?",
    )

    case.diagnosis = "Myocardial infarction"
    assert not is_coach_response_safe(
        case,
        "What ECG findings would make MI more likely?",
    )
    assert not is_coach_response_safe(
        case,
        "This sounds like a heart attack.",
    )


def test_coach_response_guardrail_blocks_direct_management_variants():
    case = make_mock_case()

    unsafe_responses = [
        "Obtain a 12-lead ECG now.",
        "The next step would be to start heparin.",
        "This patient needs broad-spectrum antibiotics and fluids.",
        "Proceed with thrombolysis.",
        "Call the cath lab and give aspirin.",
        "Manage with insulin infusion after fluids.",
        "The patient should receive aspirin now.",
        "Heparin is indicated in this case.",
        "Antibiotics are warranted now.",
        "A fluid bolus should be given.",
        "A cath lab activation is required.",
    ]

    for response in unsafe_responses:
        assert not is_coach_response_safe(case, response), response


def test_coach_response_guardrail_blocks_korean_direct_management_variants():
    case = make_mock_case()

    unsafe_responses = [
        "헤파린을 바로 시작하세요.",
        "아스피린 투여가 필요합니다.",
        "인슐린 처방을 진행해야 합니다.",
        "승압제를 즉시 올리세요.",
        "혈전용해를 시행합니다.",
    ]

    for response in unsafe_responses:
        assert not is_coach_response_safe(case, response), response


def test_coach_response_guardrail_allows_socratic_safety_questions():
    case = make_mock_case()

    safe_responses = [
        "Before starting insulin, what safety check matters most?",
        "What contraindications to thrombolysis would you need to rule out?",
        "What information would you need before ordering CT imaging?",
        "Which finding would make this presentation time-sensitive?",
        "How would you decide whether anticoagulation is safe in this scenario?",
        "What would make heparin indicated or unsafe in this simulated case?",
        "Which finding would make antibiotics time-critical?",
        "헤파린을 시작하기 전에 어떤 안전 확인이 필요할까요?",
        "아스피린이 안전한지 판단하려면 무엇을 확인해야 할까요?",
    ]

    for response in safe_responses:
        assert is_coach_response_safe(case, response), response


@pytest.mark.asyncio
async def test_stream_halts_for_real_patient_signal(monkeypatch: pytest.MonkeyPatch):
    class ProviderThatShouldNotBeCalled:
        async def stream(self, **_kwargs):
            raise AssertionError("provider should not be called for real-patient signals")

    monkeypatch.setattr(
        "app.services.socratic_coach.get_provider",
        lambda: ProviderThatShouldNotBeCalled(),
    )

    chunks = [
        chunk
        async for chunk in stream_coach_response(
            case=make_mock_case(),
            conversation_history=[],
            student_message="My patient is deteriorating right now",
            turn_number=1,
        )
    ]

    assert chunks[0].type == "text_delta"
    assert chunks[0].content == REAL_PATIENT_SAFETY_RESPONSE
    assert chunks[1].type == "done"


@pytest.mark.asyncio
async def test_stream_halts_for_korean_real_patient_signal(monkeypatch: pytest.MonkeyPatch):
    class ProviderThatShouldNotBeCalled:
        async def stream(self, **_kwargs):
            raise AssertionError("provider should not be called for real-patient signals")

    monkeypatch.setattr(
        "app.services.socratic_coach.get_provider",
        lambda: ProviderThatShouldNotBeCalled(),
    )

    chunks = [
        chunk
        async for chunk in stream_coach_response(
            case=make_mock_case(),
            conversation_history=[],
            student_message="제 환자가 지금 숨을 못 쉬고 있습니다.",
            turn_number=1,
        )
    ]

    assert chunks[0].type == "text_delta"
    assert chunks[0].content == KOREAN_REAL_PATIENT_SAFETY_RESPONSE
    assert chunks[1].type == "done"


@pytest.mark.asyncio
async def test_stream_replaces_diagnosis_leak_with_safe_question(monkeypatch: pytest.MonkeyPatch):
    class UnsafeProvider:
        async def stream(self, **_kwargs):
            yield StreamChunk(type="text_delta", content="This is STEMI. ")
            yield StreamChunk(type="text_delta", content="You should activate the cath lab.")
            yield StreamChunk(type="done")

    monkeypatch.setattr(
        "app.services.socratic_coach.get_provider",
        lambda: UnsafeProvider(),
    )

    chunks = [
        chunk
        async for chunk in stream_coach_response(
            case=make_mock_case(),
            conversation_history=[],
            student_message="In this simulated case, I am building a differential.",
            turn_number=1,
        )
    ]

    response_text = "".join(chunk.content for chunk in chunks if chunk.type == "text_delta")
    assert response_text == SAFE_GUARDRAIL_RESPONSE
    assert "STEMI" not in response_text
    assert "cath lab" not in response_text


@pytest.mark.asyncio
async def test_stream_replaces_direct_management_advice_with_safe_question(
    monkeypatch: pytest.MonkeyPatch,
):
    class UnsafeManagementProvider:
        async def stream(self, **_kwargs):
            yield StreamChunk(type="text_delta", content="Obtain a 12-lead ECG now. ")
            yield StreamChunk(
                type="text_delta",
                content="This patient needs broad-spectrum antibiotics.",
            )
            yield StreamChunk(type="done")

    monkeypatch.setattr(
        "app.services.socratic_coach.get_provider",
        lambda: UnsafeManagementProvider(),
    )

    chunks = [
        chunk
        async for chunk in stream_coach_response(
            case=make_mock_case(),
            conversation_history=[],
            student_message="In this simulated case, I am thinking through management.",
            turn_number=1,
        )
    ]

    response_text = "".join(chunk.content for chunk in chunks if chunk.type == "text_delta")
    assert response_text == SAFE_GUARDRAIL_RESPONSE
    assert "Obtain a 12-lead ECG now" not in response_text
    assert "broad-spectrum antibiotics" not in response_text


def test_management_safety_redirect_response_is_socratic():
    assert "what contraindications or safety checks" in MANAGEMENT_SAFETY_REDIRECT_RESPONSE
    assert "simulated case" in MANAGEMENT_SAFETY_REDIRECT_RESPONSE


@pytest.mark.asyncio
async def test_stream_includes_current_safety_focus_in_system_prompt(
    monkeypatch: pytest.MonkeyPatch,
):
    captured: dict[str, str] = {}

    class CapturingProvider:
        async def stream(self, **kwargs):
            captured["system"] = kwargs["system"]
            yield StreamChunk(
                type="text_delta",
                content="What safety check would you complete before acting?",
            )
            yield StreamChunk(type="done")

    monkeypatch.setattr(
        "app.services.socratic_coach.get_provider",
        lambda: CapturingProvider(),
    )

    chunks = [
        chunk
        async for chunk in stream_coach_response(
            case=make_mock_case(),
            conversation_history=[],
            student_message="In this simulated case, I need to think before treatment.",
            turn_number=1,
            uncovered_safety_targets={
                "red_flags": [],
                "time_critical_actions": [],
                "contraindication_checks": [
                    "Aortic dissection features before anticoagulation",
                ],
            },
        )
    ]

    response_text = "".join(chunk.content for chunk in chunks if chunk.type == "text_delta")
    assert response_text == "What safety check would you complete before acting?"
    assert "CURRENT TURN SAFETY FOCUS" in captured["system"]
    assert "Aortic dissection features before anticoagulation" in captured["system"]
    assert "Do not quote, enumerate, or reveal this checklist" in captured["system"]
