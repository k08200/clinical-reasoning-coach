from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel


class ClinicalCaseCreate(BaseModel):
    title: str
    specialty: str
    difficulty: str = "medium"
    chief_complaint: str
    patient_demographics: dict
    history_of_present_illness: str
    past_medical_history: str
    medications: list[str] = []
    physical_exam: dict
    initial_labs: dict = {}
    diagnosis: str
    key_teaching_points: list[str] = []
    cognitive_traps: list[str] = []
    coach_guidance: str


class ClinicalCaseResponse(BaseModel):
    id: uuid.UUID
    title: str
    specialty: str
    difficulty: str
    chief_complaint: str
    patient_demographics: dict
    history_of_present_illness: str
    past_medical_history: str
    medications: list[str]
    physical_exam: dict
    initial_labs: dict
    key_teaching_points: list[str]
    cognitive_traps: list[str]
    times_used: int
    created_at: datetime
    # NOTE: diagnosis and coach_guidance are NEVER included in this response schema

    model_config = {"from_attributes": True}


class GenerateCaseRequest(BaseModel):
    specialty: str | None = None
    difficulty: str = "medium"
    seed_scenario: str | None = None
