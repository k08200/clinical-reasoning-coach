from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, Integer, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ClinicalCase(Base):
    __tablename__ = "clinical_cases"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    specialty: Mapped[str] = mapped_column(String(100), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(50), nullable=False, default="medium")
    chief_complaint: Mapped[str] = mapped_column(Text, nullable=False)
    patient_demographics: Mapped[dict] = mapped_column(JSON, nullable=False)
    history_of_present_illness: Mapped[str] = mapped_column(Text, nullable=False)
    past_medical_history: Mapped[str] = mapped_column(Text, nullable=False)
    medications: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    physical_exam: Mapped[dict] = mapped_column(JSON, nullable=False)
    initial_labs: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    diagnosis: Mapped[str] = mapped_column(String(500), nullable=False)
    key_teaching_points: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    cognitive_traps: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Hidden from students — only used by AI coach
    coach_guidance: Mapped[str] = mapped_column(Text, nullable=False)
    times_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    sessions: Mapped[list["CoachingSession"]] = relationship(
        "CoachingSession", back_populates="case", lazy="selectin"
    )
