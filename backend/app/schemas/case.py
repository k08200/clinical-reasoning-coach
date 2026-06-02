from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel, Field, field_validator


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
    review_label: str
    requires_caution: bool
    last_reviewed_at: str | None = None
    review_valid_until: str | None = None
    review_stale: bool = False


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


class ClinicalCaseReviewDetailResponse(ClinicalCaseResponse):
    diagnosis: str
    clinical_red_flags: list[str]
    time_critical_actions: list[str]
    contraindication_checks: list[str]
    clinical_sources: list[dict]
    coach_guidance: str
    reviewed_by_user_id: uuid.UUID | None = None
    review_notes: str | None = None
    # Reviewer-only response. This intentionally includes answer keys, hidden
    # safety metadata, and raw source evidence so clinician reviewers can audit
    # the case before marking it reviewed.


class GenerateCaseRequest(BaseModel):
    specialty: str | None = None
    difficulty: str = "medium"
    seed_scenario: str | None = None
    acknowledge_unreviewed_generation: bool = False


class ClinicalReviewRequest(BaseModel):
    clinical_accuracy_confirmed: bool = Field(
        default=False,
        validate_default=True,
        description="Reviewer confirms the diagnosis, key findings, and teaching points are clinically accurate.",
    )
    source_alignment_confirmed: bool = Field(
        default=False,
        validate_default=True,
        description="Reviewer confirms cited sources support the case content.",
    )
    educational_safety_confirmed: bool = Field(
        default=False,
        validate_default=True,
        description="Reviewer confirms the case is safe for educational simulation and not patient care.",
    )
    review_notes: str | None = Field(default=None, max_length=2000)

    @field_validator(
        "clinical_accuracy_confirmed",
        "source_alignment_confirmed",
        "educational_safety_confirmed",
    )
    @classmethod
    def require_confirmation(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("Clinician review requires all confirmations")
        return value


class ClinicalCaseReviewResponse(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    reviewer_user_id: uuid.UUID
    prior_review_status: str
    resulting_review_status: str
    confirmations: dict
    source_snapshot: dict
    review_notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
