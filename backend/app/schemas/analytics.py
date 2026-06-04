from __future__ import annotations

import uuid
from pydantic import BaseModel


class BiasPattern(BaseModel):
    bias_type: str
    count: int
    severity_distribution: dict[str, int]
    avg_confidence: float


class ReasoningTrend(BaseModel):
    session_number: int
    avg_score: float
    date: str


class SafetyAnalyticsSummary(BaseModel):
    total_events: int
    open_events: int
    high_severity_events: int
    open_high_risk_events: int
    safety_locked_sessions: int
    real_patient_or_emergency_events: int
    privacy_events: int
    coach_guardrail_events: int
    management_safety_events: int


class UserAnalytics(BaseModel):
    user_id: uuid.UUID
    total_sessions: int
    completed_sessions: int
    safety_locked_sessions: int
    total_messages: int
    avg_reasoning_score: float
    bias_patterns: list[BiasPattern]
    reasoning_trend: list[ReasoningTrend]
    safety_summary: SafetyAnalyticsSummary
    total_tokens_used: int
    strongest_areas: list[str]
    weakest_areas: list[str]
    specialty_performance: dict[str, float]
