from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel


class SessionCreate(BaseModel):
    case_id: uuid.UUID


class MessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    reasoning_score: float | None
    biases_detected: list
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    case_id: uuid.UUID
    status: str
    final_reasoning_score: float | None
    reasoning_map: dict
    bias_summary: dict
    total_input_tokens: int
    total_output_tokens: int
    total_thinking_tokens: int
    messages: list[MessageResponse]
    started_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class ReviewSource(BaseModel):
    title: str
    organization: str
    url: str
    supports: list[str]


class ReviewBiasFeedback(BaseModel):
    bias_type: str
    severity: str
    evidence: str
    confidence: float
    message_turn: int


class SessionReviewResponse(BaseModel):
    session_id: uuid.UUID
    case_id: uuid.UUID
    diagnosis: str
    score_breakdown: dict[str, float]
    strengths: list[str]
    gaps: list[str]
    coach_insights: list[str]
    bias_feedback: list[ReviewBiasFeedback]
    key_teaching_points: list[str]
    cognitive_traps: list[str]
    clinical_sources: list[ReviewSource]
    review_status: str
    last_reviewed_at: str | None


class SessionSummary(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    status: str
    final_reasoning_score: float | None
    total_input_tokens: int
    total_output_tokens: int
    total_thinking_tokens: int
    started_at: datetime
    completed_at: datetime | None
    message_count: int = 0

    model_config = {"from_attributes": True}


class SendMessageRequest(BaseModel):
    content: str


class CompleteSessionRequest(BaseModel):
    pass
