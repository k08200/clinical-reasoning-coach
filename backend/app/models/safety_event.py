from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, DateTime, Integer, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class SafetyEvent(Base):
    __tablename__ = "safety_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("coaching_sessions.id"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    severity: Mapped[str] = mapped_column(String(50), nullable=False, default="high")
    action_taken: Mapped[str] = mapped_column(String(100), nullable=False)
    detected_terms: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    message_turn: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="open", server_default="open"
    )
    resolution_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    session: Mapped["CoachingSession"] = relationship(
        "CoachingSession", back_populates="safety_events"
    )
    user: Mapped["User"] = relationship(
        "User", back_populates="safety_events", foreign_keys=[user_id]
    )
    resolved_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[resolved_by_user_id], lazy="selectin"
    )
