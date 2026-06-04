from __future__ import annotations

from datetime import datetime
import uuid

from pydantic import BaseModel, Field, field_validator, model_validator

MIN_CLINICAL_REVIEW_NOTES_LENGTH = 30
CLINICAL_REVIEW_NOTE_SOURCE_TERMS = (
    "source",
    "sources",
    "cited",
    "citation",
    "evidence",
    "guideline",
    "guidelines",
)
CLINICAL_REVIEW_NOTE_SAFETY_TERMS = (
    "safety",
    "contraindication",
    "contraindications",
    "red flag",
    "red flags",
    "time-critical",
    "time critical",
)
CLINICAL_REVIEW_NOTE_EDUCATIONAL_TERMS = (
    "education",
    "educational",
    "simulation",
    "simulated",
    "limitation",
    "limitations",
    "not patient care",
)
MAX_SEED_SCENARIO_LENGTH = 2000
VALID_GENERATION_SPECIALTIES = {
    "cardiology",
    "emergency_medicine",
    "internal_medicine",
    "neurology",
    "pediatrics",
    "psychiatry",
    "surgery",
}
VALID_CASE_DIFFICULTIES = {"easy", "medium", "hard"}


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
    review_date_invalid: bool = False
    review_audit_missing: bool = False
    review_audit_incomplete: bool = False
    review_content_changed: bool = False


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
    source_provenance: ClinicalSourceProvenance
    times_used: int
    created_at: datetime
    # NOTE: diagnosis, coach_guidance, teaching points, cognitive traps, hidden
    # safety metadata, raw clinical sources, source URLs/titles, and internal
    # source support notes are NEVER included here because they can reveal the
    # case answer or internal validation notes. source_provenance exposes only
    # coarse trust metadata.

    model_config = {"from_attributes": True}


class ClinicalCaseReviewDetailResponse(ClinicalCaseResponse):
    diagnosis: str
    key_teaching_points: list[str]
    cognitive_traps: list[str]
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
    specialty: str | None = Field(default=None, max_length=80)
    difficulty: str = Field(default="medium", max_length=20)
    seed_scenario: str | None = Field(default=None, max_length=MAX_SEED_SCENARIO_LENGTH)
    acknowledge_unreviewed_generation: bool = False

    @field_validator("specialty", "difficulty", "seed_scenario", mode="before")
    @classmethod
    def strip_generation_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        return stripped or None

    @field_validator("specialty")
    @classmethod
    def validate_generation_specialty(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if value not in VALID_GENERATION_SPECIALTIES:
            raise ValueError("specialty is not supported for case generation")
        return value

    @field_validator("difficulty")
    @classmethod
    def validate_generation_difficulty(cls, value: str) -> str:
        if value not in VALID_CASE_DIFFICULTIES:
            raise ValueError("difficulty must be easy, medium, or hard")
        return value


class ClinicalSourceAlignmentChecks(BaseModel):
    teaching_points_supported: bool = False
    red_flags_supported: bool = False
    time_critical_actions_supported: bool = False
    contraindication_checks_supported: bool = False

    @property
    def all_confirmed(self) -> bool:
        return all((
            self.teaching_points_supported,
            self.red_flags_supported,
            self.time_critical_actions_supported,
            self.contraindication_checks_supported,
        ))


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
    source_alignment_checks: ClinicalSourceAlignmentChecks = Field(
        default_factory=ClinicalSourceAlignmentChecks,
        description=(
            "Reviewer confirms cited sources support teaching points and hidden safety metadata."
        ),
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

    @model_validator(mode="after")
    def require_source_alignment_checklist(self) -> "ClinicalReviewRequest":
        if self.source_alignment_confirmed and not self.source_alignment_checks.all_confirmed:
            raise ValueError(
                "Source alignment confirmation requires all source alignment checks"
            )
        return self

    @field_validator("review_notes")
    @classmethod
    def require_review_notes(cls, value: str | None) -> str:
        note = (value or "").strip()
        if len(note) < MIN_CLINICAL_REVIEW_NOTES_LENGTH:
            raise ValueError(
                "Clinical review notes must summarize source alignment, safety checks, and educational limitations"
            )
        normalized_note = note.lower()
        has_source_summary = any(
            term in normalized_note for term in CLINICAL_REVIEW_NOTE_SOURCE_TERMS
        )
        has_safety_summary = any(
            term in normalized_note for term in CLINICAL_REVIEW_NOTE_SAFETY_TERMS
        )
        has_educational_summary = any(
            term in normalized_note for term in CLINICAL_REVIEW_NOTE_EDUCATIONAL_TERMS
        )
        if not (has_source_summary and has_safety_summary and has_educational_summary):
            raise ValueError(
                "Clinical review notes must mention source alignment, safety checks, and educational limitations"
            )
        return note


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
