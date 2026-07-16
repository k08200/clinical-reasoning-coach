from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class GovernanceCaseBlocker(BaseModel):
    case_id: uuid.UUID
    title: str
    reasons: list[str] = Field(default_factory=list)


class GovernanceReleaseBlocker(BaseModel):
    code: str
    count: int
    message: str


class ModelReleaseClinicalReviewRequest(BaseModel):
    practice_scope: str = Field(min_length=3, max_length=200)
    output_safety_confirmed: bool = Field(default=False, validate_default=True)
    socratic_integrity_confirmed: bool = Field(default=False, validate_default=True)
    latency_confirmed: bool = Field(default=False, validate_default=True)
    educational_use_only_confirmed: bool = Field(default=False, validate_default=True)
    review_notes: str = Field(min_length=30, max_length=2000)

    @classmethod
    def _require_true(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("Model release clinical review requires all confirmations")
        return value

    _validate_confirmations = field_validator(
        "output_safety_confirmed",
        "socratic_integrity_confirmed",
        "latency_confirmed",
        "educational_use_only_confirmed",
    )(_require_true)

    @field_validator("practice_scope", "review_notes")
    @classmethod
    def _strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Model release clinical review text is required")
        return value


class ModelReleaseClinicalReviewResponse(BaseModel):
    id: uuid.UUID
    provider: str
    model: str
    evaluation_sha256: str
    reviewer_user_id: uuid.UUID
    practice_scope: str
    confirmations: dict
    review_notes: str
    created_at: datetime

    model_config = {"from_attributes": True}


class GovernanceReadinessResponse(BaseModel):
    learner_eligible_case_count: int
    case_blocker_count: int
    case_blockers: list[GovernanceCaseBlocker] = Field(default_factory=list)
    open_safety_event_count: int
    open_high_risk_safety_event_count: int
    verified_clinician_reviewer_count: int
    expired_clinician_reviewer_count: int
    pending_clinician_reviewer_count: int
    suspended_clinician_reviewer_count: int
    consent_renewal_required_user_count: int
    provider_ready: bool
    provider_verification: str
    provider_detail: str
    model_release_approval_current: bool
    model_release_approval_detail: str
    model_release_clinical_reviewer_count: int
    required_model_release_clinical_reviewers: int
    release_ready: bool
    release_blockers: list[GovernanceReleaseBlocker] = Field(default_factory=list)
