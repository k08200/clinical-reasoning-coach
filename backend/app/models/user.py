from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    training_level: Mapped[str] = mapped_column(
        String(50), nullable=False, default="medical_student"
    )  # medical_student, intern, resident, fellow
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sessions: Mapped[list["CoachingSession"]] = relationship(
        "CoachingSession", back_populates="user", lazy="selectin"
    )
    token_usages: Mapped[list["TokenUsage"]] = relationship(
        "TokenUsage", back_populates="user", lazy="selectin"
    )
