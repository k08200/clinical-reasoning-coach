from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class GovernanceCaseBlocker(BaseModel):
    case_id: uuid.UUID
    title: str
    reasons: list[str] = Field(default_factory=list)


class GovernanceReleaseBlocker(BaseModel):
    code: str
    count: int
    message: str


class GovernanceReadinessResponse(BaseModel):
    learner_eligible_case_count: int
    case_blocker_count: int
    case_blockers: list[GovernanceCaseBlocker] = Field(default_factory=list)
    open_safety_event_count: int
    open_high_risk_safety_event_count: int
    verified_clinician_reviewer_count: int
    pending_clinician_reviewer_count: int
    suspended_clinician_reviewer_count: int
    consent_renewal_required_user_count: int
    release_ready: bool
    release_blockers: list[GovernanceReleaseBlocker] = Field(default_factory=list)
