"""
Dynamic clinical case generator.

In mock/ollama mode: returns the pre-built demo case or a simplified version.
In claude mode: generates unique cases via Claude with extended thinking.
"""
from __future__ import annotations

import json
import re

from app.config import get_settings
from app.services.provider_factory import get_provider
from app.schemas.case import ClinicalCaseCreate
import random as _random
from app.services.mock_provider import CASE_POOL

settings = get_settings()

CASE_GENERATION_SYSTEM = """You are a clinical case designer for medical education.
Create realistic, educationally valuable patient cases that test diagnostic reasoning.

Rules:
- Cases must have clear cognitive traps (anchoring opportunities, red herrings)
- Include realistic vital signs, lab values, and physical exam findings
- The diagnosis should be reachable through systematic reasoning
- Do NOT make cases obscure or exotic — common presentations of common diseases
- Include 2-3 cognitive biases that students commonly fall into with this case

Return ONLY valid JSON matching this exact schema:
{
  "title": "...",
  "specialty": "...",
  "difficulty": "easy|medium|hard",
  "chief_complaint": "...",
  "patient_demographics": {"age": 0, "sex": "male|female", "weight_kg": 0, "ethnicity": "..."},
  "history_of_present_illness": "...",
  "past_medical_history": "...",
  "medications": ["..."],
  "physical_exam": {
    "vitals": {"bp": "...", "hr": 0, "rr": 0, "temp_c": 0.0, "spo2": 0},
    "general": "...", "cardiovascular": "...", "pulmonary": "...",
    "abdomen": "...", "neuro": "...", "other": "..."
  },
  "initial_labs": {"wbc": "...", "hgb": "...", "troponin": "...", "other": {}},
  "diagnosis": "...",
  "key_teaching_points": ["...", "..."],
  "cognitive_traps": ["...", "..."],
  "coach_guidance": "..."
}"""


async def generate_clinical_case(
    specialty: str | None = None,
    difficulty: str = "medium",
    seed_scenario: str | None = None,
) -> ClinicalCaseCreate:
    chosen_specialty = specialty or "internal_medicine"

    # mock/ollama providers return the demo case from complete()
    # claude provider generates a unique case
    provider = get_provider()
    user_prompt = (
        f"Generate a {difficulty} difficulty clinical case for {chosen_specialty}. "
        + (f"Scenario seed: {seed_scenario}" if seed_scenario else "Make it a realistic, common presentation.")
        + "\nThink carefully about cognitive traps and Socratic teaching opportunities."
    )

    response = await provider.complete(
        messages=[{"role": "user", "content": user_prompt}],
        system=CASE_GENERATION_SYSTEM,
    )

    raw = _extract_json(response.text)

    # Ensure required fields present
    raw.setdefault("specialty", chosen_specialty)
    raw.setdefault("difficulty", difficulty)

    return ClinicalCaseCreate(**raw)


async def generate_demo_case() -> ClinicalCaseCreate:
    """Return a randomly selected pre-built case from the case pool."""
    return ClinicalCaseCreate(**_random.choice(CASE_POOL))


def _extract_json(text: str) -> dict:
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    raise ValueError(f"No valid JSON found in response: {text[:200]}")
