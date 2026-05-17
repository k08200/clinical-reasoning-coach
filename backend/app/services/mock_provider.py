"""
Mock LLM provider — zero API key, zero cost, works offline.

Implements a rule-based Socratic coach with a curated question bank.
Detects reasoning phase and student keywords to pick relevant questions.
This is NOT a substitute for real AI coaching — it's a demo/dev mode.
"""
from __future__ import annotations

import asyncio
import json
import random
import re
from collections.abc import AsyncGenerator
from typing import Any

from app.services.provider import StreamChunk, LLMResponse

# ─── Socratic question bank ───────────────────────────────────────────────────

QUESTIONS_BY_PHASE = {
    "vitals_and_presentation": [
        "Looking at the vital signs — what stands out to you and why?",
        "What does the combination of heart rate and blood pressure tell you about this patient's hemodynamic status?",
        "If you had to identify the single most alarming finding on first glance, which would it be?",
        "How do you interpret the oxygen saturation in context with the rest of the presentation?",
        "What does the patient's general appearance suggest about the acuity of this situation?",
    ],
    "history": [
        "What aspects of the history of present illness are most relevant to narrowing your differential?",
        "How does the past medical history change your thinking about this presentation?",
        "What is the significance of the patient's current medications in this context?",
        "Are there any risk factors in this history that should elevate your concern for a life-threatening cause?",
        "What additional history would you want to gather, and why would that information matter?",
    ],
    "differential": [
        "What are the three most dangerous diagnoses you must rule out first in a case like this?",
        "You've suggested one diagnosis — what else on your differential could explain ALL of these findings?",
        "Which diagnoses on your list would be immediately life-threatening if missed?",
        "How would you rank your differentials by probability versus severity? Are those the same list?",
        "Is there a unifying diagnosis that explains both the primary complaint AND the abnormal vital signs?",
    ],
    "anchoring_challenge": [
        "You seem focused on one diagnosis. What findings would argue AGAINST that diagnosis?",
        "If I told you that diagnosis was ruled out, what would be your next hypothesis?",
        "What would make you MORE or LESS confident in that diagnosis?",
        "Are there any findings you're not yet accounting for in your current hypothesis?",
        "What is the base rate of that diagnosis in a patient with this demographic and presentation?",
    ],
    "evidence_gathering": [
        "What specific test result would most change your management right now?",
        "Before ordering that test — what clinical finding would confirm or deny your working hypothesis?",
        "What is the sensitivity and specificity of that test for your leading diagnosis?",
        "Which result would be most dangerous to miss — and how would you ensure you don't?",
        "How does the ECG finding change your differential ranking?",
    ],
    "mechanism": [
        "Why would a patient with that condition present with exactly these symptoms?",
        "What is the underlying pathophysiology that connects the symptom to the organ system?",
        "Walk me through the mechanism by which that would cause the vital sign abnormality you identified.",
        "How does age affect the typical presentation of this diagnosis?",
        "Why might this patient present atypically compared to the textbook description?",
    ],
    "premature_closure_challenge": [
        "You seem ready to commit to a diagnosis. What would your attending say if you stopped here?",
        "Before we move to management — have you definitively excluded the most dangerous alternative?",
        "What information are you still missing that could change your diagnosis entirely?",
        "Is there a simpler or more common explanation you may have overlooked?",
        "Let's test your hypothesis: if you're right, what else should we expect to find on examination?",
    ],
    "management": [
        "Before starting treatment — what is the most time-sensitive intervention in this case?",
        "What would happen to this patient if you waited 30 minutes before treating?",
        "How would you prioritize your interventions, and why in that order?",
        "What are the risks of the treatment you're proposing, and how do they compare to the risks of the disease?",
        "What is your monitoring plan — what would tell you the patient is improving or deteriorating?",
    ],
    "generic_deepening": [
        "Can you explain your reasoning process in arriving at that conclusion?",
        "What evidence-based guideline applies to this presentation?",
        "How confident are you in that assessment, and what would increase your confidence?",
        "What would your senior resident say when you present this case?",
        "Is there anything about this case that doesn't fit neatly into your working diagnosis?",
    ],
}

# Keywords that trigger specific question categories
KEYWORD_TRIGGERS = {
    "anchoring_challenge": [
        "definitely", "clearly", "obviously", "must be", "has to be",
        "i'm sure", "certain", "no doubt", "for sure",
    ],
    "premature_closure_challenge": [
        "give", "treat", "start", "order", "admit", "discharge",
        "aspirin", "heparin", "tpa", "nitro", "morphine",
    ],
    "mechanism": [
        "because", "mechanism", "pathophysiology", "why", "causes",
    ],
    "management": [
        "ecg", "troponin", "ct", "ultrasound", "xray", "x-ray",
        "labs", "blood", "culture",
    ],
}

DEMO_CASE = {
    "title": "Acute Chest Pain in a Middle-Aged Male",
    "specialty": "internal_medicine",
    "difficulty": "medium",
    "chief_complaint": "Chest pain and diaphoresis",
    "patient_demographics": {"age": 58, "sex": "male", "weight_kg": 88, "ethnicity": "Korean"},
    "history_of_present_illness": (
        "58-year-old male with sudden onset crushing substernal chest pain radiating to the left arm, "
        "onset 45 minutes ago at rest. Associated with diaphoresis, nausea, and mild dyspnea. "
        "Denies fever, cough, trauma, or recent prolonged immobility."
    ),
    "past_medical_history": "Hypertension (10 years), hyperlipidemia, smoker (20 pack-years), quit 5 years ago.",
    "medications": ["Lisinopril 10mg daily", "Atorvastatin 40mg daily", "Aspirin 100mg daily"],
    "physical_exam": {
        "vitals": {"bp": "158/96", "hr": 102, "rr": 18, "temp_c": 36.8, "spo2": 95},
        "general": "Diaphoretic, pale, anxious, in moderate distress",
        "cardiovascular": "Tachycardic, regular rhythm, no murmurs or rubs. JVP normal.",
        "pulmonary": "Mild bibasilar crackles on auscultation",
        "abdomen": "Soft, non-tender, no organomegaly",
        "neuro": "Alert and oriented x3, no focal deficits",
        "other": "No peripheral edema, peripheral pulses intact",
    },
    "initial_labs": {
        "wbc": "11.4 (mildly elevated)",
        "hgb": "14.2",
        "platelets": "224",
        "na": "138",
        "k": "4.1",
        "cr": "1.1",
        "glucose": "142 (mildly elevated)",
        "troponin_i": "0.04 (upper limit of normal 0.04 — borderline)",
        "bnp": "180 (mildly elevated)",
        "d_dimer": "Not yet ordered",
    },
    "diagnosis": "STEMI / ACS — ST-Elevation Myocardial Infarction",
    "key_teaching_points": [
        "Time-to-reperfusion is critical — door-to-balloon < 90 minutes",
        "Borderline troponin at presentation does not rule out ACS — repeat in 3-6 hours",
        "Bibasilar crackles suggest early Killip Class II heart failure",
        "Mild glucose elevation and WBC are expected stress responses",
    ],
    "cognitive_traps": [
        "Borderline troponin may falsely reassure students",
        "SpO2 of 95% might lead to anchoring on pulmonary embolism",
        "Mild glucose elevation might distract toward diabetic emergency",
    ],
    "coach_guidance": (
        "Guide student toward: (1) identifying high-risk features (diaphoresis, radiation, risk factors), "
        "(2) not being falsely reassured by borderline troponin, "
        "(3) recognizing early pulmonary edema (crackles + elevated BNP), "
        "(4) understanding urgency of reperfusion. "
        "Challenge premature closure on GERD or anxiety. "
        "If student jumps to aspirin/heparin, ask about ECG first — time-sensitive diagnosis requires ECG within 10 minutes."
    ),
}


# ─── Mock provider ────────────────────────────────────────────────────────────

class MockProvider:
    """Rule-based Socratic coach. No API key needed."""

    def _detect_phase(self, student_text: str, turn_number: int) -> str:
        lower = student_text.lower()

        for phase, keywords in KEYWORD_TRIGGERS.items():
            if any(kw in lower for kw in keywords):
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

    def _pick_question(self, phase: str) -> str:
        bank = QUESTIONS_BY_PHASE.get(phase, QUESTIONS_BY_PHASE["generic_deepening"])
        return random.choice(bank)

    def _build_response(self, student_text: str, turn_number: int) -> str:
        phase = self._detect_phase(student_text, turn_number)
        q1 = self._pick_question(phase)
        # Pick a second question from a different phase for depth
        other_phases = [p for p in QUESTIONS_BY_PHASE if p != phase]
        q2_phase = random.choice(other_phases)
        q2 = self._pick_question(q2_phase)
        return f"{q1}\n\nAlso consider: {q2}"

    async def stream(
        self,
        messages: list[dict[str, Any]],
        system: str,
        operation: str = "mock",
    ) -> AsyncGenerator[StreamChunk, None]:
        turn_number = sum(1 for m in messages if m.get("role") == "user")
        student_text = messages[-1].get("content", "") if messages else ""

        response = self._build_response(student_text, turn_number)

        yield StreamChunk(type="thinking_start")
        await asyncio.sleep(0.3)  # simulate thinking

        # Stream word by word for realism
        words = response.split()
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            yield StreamChunk(type="text_delta", content=chunk)
            await asyncio.sleep(0.03)

        word_count = len(response.split())
        yield StreamChunk(
            type="usage",
            usage={"input_tokens": len(student_text) // 4, "output_tokens": word_count * 2, "thinking_tokens": 50},
        )
        yield StreamChunk(type="done")

    async def complete(
        self,
        messages: list[dict[str, Any]],
        system: str,
    ) -> LLMResponse:
        user_text = messages[-1].get("content", "") if messages else ""
        # For case generation: return the pre-built demo case
        if "generate" in system.lower() or "case" in system.lower():
            return LLMResponse(
                text=json.dumps(DEMO_CASE),
                thinking="[mock] Returning pre-built demo case",
                input_tokens=100,
                output_tokens=300,
                thinking_tokens=50,
            )
        # For reasoning analysis: return a reasonable mock score
        mock_analysis = {
            "reasoning_score": 65,
            "score_breakdown": {
                "systematic_approach": 16,
                "evidence_integration": 17,
                "prioritization": 15,
                "mechanism_understanding": 17,
            },
            "biases_detected": [],
            "reasoning_node": {
                "hypothesis": _extract_hypothesis(user_text),
                "supporting_evidence": [],
                "missing_evidence": ["Further clinical data needed"],
                "reasoning_quality": "convergent",
            },
            "coach_insight": "Student is engaging with the case systematically.",
            "student_strengths": ["Engaged with the presentation"],
            "student_gaps": ["Continue developing differential"],
        }
        return LLMResponse(
            text=json.dumps(mock_analysis),
            thinking="[mock] Rule-based analysis",
            input_tokens=80,
            output_tokens=150,
            thinking_tokens=30,
        )


def _extract_hypothesis(text: str) -> str:
    """Extract the main diagnostic hypothesis from student text."""
    diagnoses = [
        "myocardial infarction", "mi", "stemi", "nstemi", "acs",
        "pulmonary embolism", "pe", "aortic dissection", "pneumonia",
        "heart failure", "angina", "gerd", "anxiety",
    ]
    lower = text.lower()
    for d in diagnoses:
        if d in lower:
            return d.upper()
    return "Under investigation"
