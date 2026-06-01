from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class ClinicalCaseCreate(BaseModel):
    title: str
    specialty: str
    difficulty: str = "medium"
    chief_complaint: str
    patient_demographics: dict
    history_of_present_illness: str
    past_medical_history: str
    medications: list[str] = Field(default_factory=list)
    physical_exam: dict
    initial_labs: dict = Field(default_factory=dict)
    diagnosis: str
    key_teaching_points: list[str] = Field(default_factory=list)
    cognitive_traps: list[str] = Field(default_factory=list)
    clinical_red_flags: list[str] = Field(default_factory=list)
    time_critical_actions: list[str] = Field(default_factory=list)
    contraindication_checks: list[str] = Field(default_factory=list)
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
    # NOTE: diagnosis, coach_guidance, and hidden safety metadata are NEVER
    # included in this response schema because they can reveal the case answer.

    model_config = {"from_attributes": True}


class GenerateCaseRequest(BaseModel):
    specialty: str | None = None
    difficulty: str = "medium"
    seed_scenario: str | None = None
