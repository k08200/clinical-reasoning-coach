from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, Float, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class BiasEvent(Base):
    __tablename__ = "bias_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("coaching_sessions.id"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    bias_type: Mapped[str] = mapped_column(String(100), nullable=False)
    # anchoring / premature_closure / availability / framing
    severity: Mapped[str] = mapped_column(String(50), nullable=False)
    # mild / moderate / severe
    evidence: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    message_turn: Mapped[int] = mapped_column(nullable=False, default=0)
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    session: Mapped["CoachingSession"] = relationship("CoachingSession", back_populates="bias_events")
