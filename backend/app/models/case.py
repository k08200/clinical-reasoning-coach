from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import ForeignKey, String, Text, DateTime, Integer, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

REVIEW_PROVENANCE = {
    "clinician_reviewed": {
        "label": "Clinician reviewed",
        "requires_caution": False,
    },
    "educational_draft": {
        "label": "Educational draft",
        "requires_caution": True,
    },
    "ai_generated_unreviewed": {
        "label": "AI-generated, unreviewed",
        "requires_caution": True,
    },
}


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
    clinical_red_flags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    time_critical_actions: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    contraindication_checks: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    clinical_sources: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    review_status: Mapped[str] = mapped_column(String(50), nullable=False, default="educational_draft")
    last_reviewed_at: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    reviewed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Hidden from students — only used by AI coach
    coach_guidance: Mapped[str] = mapped_column(Text, nullable=False)
    times_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    sessions: Mapped[list["CoachingSession"]] = relationship(
        "CoachingSession", back_populates="case", lazy="selectin"
    )

    @property
    def source_provenance(self) -> dict:
        organizations = []
        seen = set()
        for source in self.clinical_sources or []:
            organization = source.get("organization")
            if organization and organization not in seen:
                organizations.append(organization)
                seen.add(organization)

        review = REVIEW_PROVENANCE.get(
            self.review_status,
            {
                "label": "Review status unknown",
                "requires_caution": True,
            },
        )

        return {
            "source_count": len(self.clinical_sources or []),
            "organizations": organizations,
            "review_status": self.review_status,
            "review_label": review["label"],
            "requires_caution": review["requires_caution"],
            "last_reviewed_at": self.last_reviewed_at,
        }
