import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, Float, JSON, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class CoachingSession(Base):
    __tablename__ = "coaching_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinical_cases.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="active"
    )
    final_reasoning_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reasoning_trajectory: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    reasoning_map: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    bias_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    total_input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_thinking_tokens: Mapped[int] = mapped_column(Integer, default=0)
    coach_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped["User"] = relationship("User", back_populates="sessions")
    case: Mapped["ClinicalCase"] = relationship("ClinicalCase", back_populates="sessions")
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="session", order_by="Message.created_at", lazy="selectin"
    )
    bias_events: Mapped[list["BiasEvent"]] = relationship(
        "BiasEvent", back_populates="session", lazy="selectin"
    )
    token_usages: Mapped[list["TokenUsage"]] = relationship(
        "TokenUsage", back_populates="session", lazy="selectin"
    )
