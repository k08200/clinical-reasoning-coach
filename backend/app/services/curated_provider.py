"""Deterministic, source-bound provider for curated clinical reasoning exercises.

This provider never generates clinical advice. It selects only from the
versioned Socratic question banks that ship with the curated case catalogue.
It is distinct from the ``mock`` provider: it has no simulated thinking,
random selection, or dynamic case generation behavior.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import AsyncGenerator
from typing import Any

from app.services.mock_provider import (
    CASE_POOL,
    KEYWORD_TRIGGERS,
    MockProvider,
)
from app.services.provider import LLMResponse, ProviderReadiness, StreamChunk

CURATED_PROVIDER_MODEL = "curated-question-bank-v1"

# These prompts are intentionally separate from the richer development bank.
# Each item is a single question and avoids diagnosis labels, direct management
# instructions, guideline titles, and source organizations.
CURATED_QUESTIONS_BY_PHASE = {
    "vitals_and_presentation": [
        "Which vital sign or examination finding is most concerning, and why?",
        "Which finding makes this presentation time-sensitive?",
        "How do the abnormal vital signs change your immediate priorities?",
    ],
    "history": [
        "Which additional history would most change your differential, and why?",
        "Which risk factor in the history most changes the level of concern?",
        "Which medication or prior condition needs closer scrutiny before you proceed?",
    ],
    "differential": [
        "Which life-threatening possibilities should be considered before less dangerous causes?",
        "Which alternative explanation accounts for the greatest number of findings?",
        "How would you rank probability separately from the consequence of missing a condition?",
    ],
    "anchoring_challenge": [
        "Which finding would most weaken your leading hypothesis?",
        "Which competing hypothesis best explains the finding your current explanation misses?",
        "What evidence would make you substantially less confident in your current conclusion?",
    ],
    "evidence_gathering": [
        "Which available finding would most change your next step?",
        "Which result would be most dangerous to miss, and how would you recognize it?",
        "Which focused examination or investigation would best discriminate between your leading possibilities?",
    ],
    "mechanism": [
        "Which mechanism best connects the key symptom with the abnormal vital sign?",
        "How could the underlying process account for the pattern of findings?",
        "Which feature would be expected if your proposed mechanism were correct?",
    ],
    "premature_closure_challenge": [
        "Which high-risk alternative remains insufficiently assessed?",
        "Which missing finding could change your working hypothesis?",
        "What must be checked before you narrow the differential further?",
    ],
    "management": [
        "Which safety checks must be completed before management is considered?",
        "Which change in the patient would require immediate escalation under the local protocol?",
        "Which monitoring finding would make you reassess your priorities?",
    ],
    "generic_deepening": [
        "Which part of your reasoning has the weakest supporting evidence?",
        "Which finding would most change your current differential?",
        "What would you need to know before increasing your confidence?",
    ],
}

CURATED_KOREAN_QUESTIONS_BY_PHASE = {
    "vitals_and_presentation": [
        "활력징후나 진찰 소견 중 가장 우려되는 것은 무엇이며 그 이유는 무엇인가요?",
        "이 상황을 시간 민감하게 만드는 소견은 무엇인가요?",
        "비정상 활력징후는 지금 우선순위를 어떻게 바꾸나요?",
    ],
    "history": [
        "감별진단을 가장 크게 바꿀 추가 병력은 무엇이며 그 이유는 무엇인가요?",
        "병력의 어떤 위험인자가 우려 수준을 가장 크게 바꾸나요?",
        "다음 단계 전에 더 면밀히 확인해야 할 약물이나 과거력은 무엇인가요?",
    ],
    "differential": [
        "덜 위험한 원인보다 먼저 고려해야 할 생명 위협 가능성은 무엇인가요?",
        "가장 많은 소견을 설명하는 다른 가능성은 무엇인가요?",
        "발생 가능성과 놓쳤을 때의 결과를 각각 어떻게 우선순위화하겠나요?",
    ],
    "anchoring_challenge": [
        "현재 가장 앞선 가설을 가장 크게 약화할 소견은 무엇인가요?",
        "현재 설명이 놓치는 소견을 가장 잘 설명하는 경쟁 가설은 무엇인가요?",
        "현재 결론에 대한 확신을 크게 낮출 근거는 무엇인가요?",
    ],
    "evidence_gathering": [
        "다음 단계를 가장 크게 바꿀 수 있는 현재 소견은 무엇인가요?",
        "가장 놓치면 위험한 결과는 무엇이며 어떻게 알아차리겠나요?",
        "주요 가능성을 가장 잘 구분할 집중 진찰이나 검사는 무엇인가요?",
    ],
    "mechanism": [
        "핵심 증상과 비정상 활력징후를 가장 잘 연결하는 기전은 무엇인가요?",
        "기저 과정은 현재 소견의 양상을 어떻게 설명할 수 있나요?",
        "제안한 기전이 맞다면 어떤 소견이 예상되나요?",
    ],
    "premature_closure_challenge": [
        "아직 충분히 평가되지 않은 고위험 가능성은 무엇인가요?",
        "현재 가설을 바꿀 수 있는 누락된 소견은 무엇인가요?",
        "감별을 더 좁히기 전에 무엇을 확인해야 하나요?",
    ],
    "management": [
        "관리를 고려하기 전에 반드시 확인해야 할 안전 점검은 무엇인가요?",
        "지역 프로토콜상 즉시 상향 조정이 필요한 변화는 무엇인가요?",
        "우선순위를 다시 평가하게 만들 모니터링 소견은 무엇인가요?",
    ],
    "generic_deepening": [
        "현재 추론에서 근거가 가장 약한 부분은 무엇인가요?",
        "현재 감별을 가장 크게 바꿀 소견은 무엇인가요?",
        "확신을 높이기 전에 무엇을 더 알아야 하나요?",
    ],
}

KOREAN_PHASE_KEYWORD_TRIGGERS = {
    "anchoring_challenge": ("확실", "분명", "틀림없"),
    "premature_closure_challenge": ("치료", "투여", "처방", "처치"),
    "mechanism": ("기전", "병태생리", "왜"),
    "management": ("심전도", "검사", "영상", "혈액"),
}


class CuratedProvider(MockProvider):
    """Serve deterministic question-only coaching for the curated case library."""

    async def readiness(self) -> ProviderReadiness:
        return ProviderReadiness(
            ready=True,
            verification="verified",
            detail=(
                "The deterministic curated question bank is available; it does not "
                "generate clinical advice."
            ),
        )

    @staticmethod
    def _selection_index(count: int, *parts: str) -> int:
        digest = hashlib.sha256("\x1f".join(parts).encode("utf-8")).digest()
        return int.from_bytes(digest[:8], "big") % count

    def _select(self, values: list[str], *parts: str) -> str:
        return values[self._selection_index(len(values), *parts)]

    def _detect_phase(self, student_text: str, turn_number: int) -> str:
        lower = student_text.lower()
        for phase, keywords in KEYWORD_TRIGGERS.items():
            if any(keyword in lower for keyword in keywords):
                return phase
        for phase, keywords in KOREAN_PHASE_KEYWORD_TRIGGERS.items():
            if any(keyword in student_text for keyword in keywords):
                return phase
        if turn_number == 1:
            return "vitals_and_presentation"
        if turn_number == 2:
            return "history"
        if turn_number <= 4:
            return "differential"
        if turn_number <= 6:
            return "evidence_gathering"
        if turn_number <= 8:
            return "mechanism"
        return "generic_deepening"

    def _build_response(
        self,
        student_text: str,
        turn_number: int,
        specialty: str | None = None,
    ) -> str:
        phase = self._detect_phase(student_text, turn_number)
        seed = (student_text, str(turn_number), specialty or "general")
        questions_by_phase = (
            CURATED_KOREAN_QUESTIONS_BY_PHASE
            if re.search(r"[가-힣]", student_text)
            else CURATED_QUESTIONS_BY_PHASE
        )
        first = self._select(questions_by_phase[phase], phase, *seed)
        # Specialty question banks can include hidden diagnosis labels. The curated
        # provider deliberately uses only diagnosis-independent questions so every
        # response is safe before the output guardrail has to intervene.
        other_phases = [name for name in questions_by_phase if name != phase]
        second_phase = self._select(other_phases, "second-phase", phase, *seed)
        second = self._select(
            questions_by_phase[second_phase],
            second_phase,
            *seed,
        )
        return f"{first}\n\n{second}"

    async def stream(
        self,
        messages: list[dict[str, Any]],
        system: str,
        operation: str = "curated",
    ) -> AsyncGenerator[StreamChunk, None]:
        turn_number = sum(1 for message in messages if message.get("role") == "user")
        student_text = messages[-1].get("content", "") if messages else ""
        response = self._build_response(
            student_text,
            turn_number,
            self._detect_specialty(system),
        )
        yield StreamChunk(type="text_delta", content=response)
        yield StreamChunk(
            type="usage",
            usage={
                "input_tokens": len(student_text) // 4,
                "output_tokens": len(response.split()) * 2,
                "thinking_tokens": 0,
            },
        )
        yield StreamChunk(type="done")

    async def complete(
        self,
        messages: list[dict[str, Any]],
        system: str,
    ) -> LLMResponse:
        user_text = messages[-1].get("content", "") if messages else ""
        if "case designer" not in system.lower():
            return await super().complete(messages, system)

        index = self._selection_index(len(CASE_POOL), system, user_text)
        return LLMResponse(
            text=json.dumps(CASE_POOL[index]),
            thinking="",
            input_tokens=100,
            output_tokens=300,
            thinking_tokens=0,
        )
