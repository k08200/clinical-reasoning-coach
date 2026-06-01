from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ClinicalCaseReview(Base):
    __tablename__ = "clinical_case_reviews"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinical_cases.id"), nullable=False, index=True
    )
    reviewer_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    prior_review_status: Mapped[str] = mapped_column(String(50), nullable=False)
    resulting_review_status: Mapped[str] = mapped_column(String(50), nullable=False)
    confirmations: Mapped[dict] = mapped_column(JSON, nullable=False)
    source_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    case: Mapped["ClinicalCase"] = relationship(
        "ClinicalCase", back_populates="clinical_reviews"
    )
    reviewer: Mapped["User"] = relationship(
        "User", back_populates="clinical_case_reviews"
    )
