import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Text, DateTime, Float, Integer, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("coaching_sessions.id"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(
        "role", Text, nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    thinking_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reasoning_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reasoning_analysis: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    biases_detected: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    thinking_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    session: Mapped["CoachingSession"] = relationship(
        "CoachingSession", back_populates="messages"
    )
