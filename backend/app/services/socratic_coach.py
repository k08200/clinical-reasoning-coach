"""
Socratic coaching engine.

INVARIANT: Never reveals the diagnosis. Always responds with questions.
Uses the configured LLM provider (claude / ollama / mock).
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from app.services.provider import StreamChunk
from app.services.provider_factory import get_provider
from app.models.case import ClinicalCase

SOCRATIC_SYSTEM = """You are a Socratic clinical reasoning coach. Your identity and purpose:

ABSOLUTE RULES (NEVER BREAK THESE):
1. NEVER state, hint at, or confirm the diagnosis — not even indirectly
2. NEVER say "You're on the right track" or "That's correct/incorrect"
3. NEVER list differentials for the student — make them generate their own
4. ALWAYS respond with questions, not statements
5. If a student directly asks "what is the diagnosis?", redirect with a question

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
Cognitive traps in this case: {', '.join(case.cognitive_traps)}
Key teaching points: {', '.join(case.key_teaching_points)}

PATIENT PRESENTATION (what student sees):
Chief complaint: {case.chief_complaint}
Demographics: {case.patient_demographics}
HPI: {case.history_of_present_illness}
PMH: {case.past_medical_history}
Medications: {', '.join(case.medications) if case.medications else 'None'}
Physical exam: {case.physical_exam}
Labs: {case.initial_labs}"""


def _build_opening_message(case: ClinicalCase) -> str:
    demographics = case.patient_demographics
    age = demographics.get("age", "unknown")
    sex = demographics.get("sex", "patient")
    vitals = case.physical_exam.get("vitals", {})

    return f"""Let me present you with a case.

**Chief Complaint:** {case.chief_complaint}

**Patient:** {age}-year-old {sex}

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

Before we go further — what are your initial thoughts? What findings stand out to you, and what questions do you have?"""


async def stream_coach_response(
    case: ClinicalCase,
    conversation_history: list[dict[str, Any]],
    student_message: str,
    turn_number: int,
) -> AsyncGenerator[StreamChunk, None]:
    case_context = _build_case_context(case)
    full_system = f"{SOCRATIC_SYSTEM}\n\n{case_context}"

    messages = list(conversation_history)
    messages.append({"role": "user", "content": student_message})

    provider = get_provider()
    async for chunk in provider.stream(
        messages=messages,
        system=full_system,
        operation="socratic_turn",
    ):
        yield chunk


def get_opening_message(case: ClinicalCase) -> str:
    return _build_opening_message(case)
