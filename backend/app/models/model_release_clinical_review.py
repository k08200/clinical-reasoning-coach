from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ModelReleaseClinicalReview(Base):
    """An independent clinician attestation for one exact evaluated model release."""

    __tablename__ = "model_release_clinical_reviews"
    __table_args__ = (
        UniqueConstraint(
            "provider",
            "model",
            "evaluation_sha256",
            "reviewer_user_id",
            name="uq_model_release_clinical_review_reviewer",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    evaluation_sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    reviewer_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    practice_scope: Mapped[str] = mapped_column(String(200), nullable=False)
    confirmations: Mapped[dict] = mapped_column(JSON, nullable=False)
    review_notes: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
