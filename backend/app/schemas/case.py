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
    clinical_sources: list[dict] = Field(default_factory=list)
    review_status: str = "educational_draft"
    last_reviewed_at: str | None = None
    coach_guidance: str


class ClinicalSourceProvenance(BaseModel):
    source_count: int
    organizations: list[str] = Field(default_factory=list)
    review_status: str
    last_reviewed_at: str | None = None


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
    source_provenance: ClinicalSourceProvenance
    times_used: int
    created_at: datetime
    # NOTE: diagnosis, coach_guidance, hidden safety metadata, raw clinical
    # sources, source URLs/titles, and internal source support notes are NEVER
    # included here because they can reveal the case answer or internal
    # validation notes. source_provenance exposes only coarse trust metadata.

    model_config = {"from_attributes": True}


class GenerateCaseRequest(BaseModel):
    specialty: str | None = None
    difficulty: str = "medium"
    seed_scenario: str | None = None
