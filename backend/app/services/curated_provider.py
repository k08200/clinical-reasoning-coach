"""Deterministic, source-bound provider for curated clinical reasoning exercises.

This provider never generates clinical advice. It selects only from the
versioned Socratic question banks that ship with the curated case catalogue.
It is distinct from the ``mock`` provider: it has no simulated thinking,
random selection, or dynamic case generation behavior.
"""
from __future__ import annotations

import hashlib
import json
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
        first = self._select(CURATED_QUESTIONS_BY_PHASE[phase], phase, *seed)
        # Specialty question banks can include hidden diagnosis labels. The curated
        # provider deliberately uses only diagnosis-independent questions so every
        # response is safe before the output guardrail has to intervene.
        other_phases = [name for name in CURATED_QUESTIONS_BY_PHASE if name != phase]
        second_phase = self._select(other_phases, "second-phase", phase, *seed)
        second = self._select(
            CURATED_QUESTIONS_BY_PHASE[second_phase],
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
