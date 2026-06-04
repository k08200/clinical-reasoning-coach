from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

VALID_SAFETY_EVENT_TYPES = {
    "management_before_safety_checks",
    "possible_patient_identifier",
    "real_patient_or_emergency_signal",
    "unsafe_coach_output_guardrail",
}
VALID_SAFETY_EVENT_SEVERITIES = {"low", "medium", "high"}
VALID_SAFETY_EVENT_STATUSES = {"open", "resolved"}
MIN_RESOLUTION_NOTE_LENGTH = 20
RESOLUTION_NOTE_REVIEW_TERMS = {
    "addressed",
    "audit",
    "discussed",
    "escalated",
    "review",
    "reviewed",
    "supervisor",
    "감사",
    "검토",
    "논의",
    "보고",
    "상급자",
    "슈퍼바이저",
    "조치",
    "지도",
    "처리",
}


class SafetyEventResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    case_id: uuid.UUID
    session_status: str
    user_id: uuid.UUID
    user_email: str
    user_full_name: str
    event_type: str
    severity: str
    action_taken: str
    detected_terms: list[str]
    message_turn: int
    note: str
    status: str
    resolution_note: str | None
    resolved_at: datetime | None
    resolved_by_user_id: uuid.UUID | None
    resolved_by_user_email: str | None
    resolved_by_user_full_name: str | None
    created_at: datetime


class SafetyEventResolutionRequest(BaseModel):
    status: str
    resolution_note: str | None = Field(default=None, max_length=2000)

    @field_validator("status")
    @classmethod
    def valid_status(cls, value: str) -> str:
        if value not in VALID_SAFETY_EVENT_STATUSES:
            raise ValueError(f"status must be one of {VALID_SAFETY_EVENT_STATUSES}")
        return value

    @model_validator(mode="after")
    def require_resolution_note_for_resolved(self) -> "SafetyEventResolutionRequest":
        if self.status != "resolved":
            return self

        note = (self.resolution_note or "").strip()
        if not note:
            raise ValueError("resolution_note is required when resolving a safety event")
        if len(note) < MIN_RESOLUTION_NOTE_LENGTH:
            raise ValueError(
                "resolution_note must summarize the safety review or escalation"
            )
        if not any(term in note.lower() for term in RESOLUTION_NOTE_REVIEW_TERMS):
            raise ValueError(
                "resolution_note must mention review, escalation, or how the issue was addressed"
            )
        return self
