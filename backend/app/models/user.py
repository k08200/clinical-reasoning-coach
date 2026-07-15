from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Boolean, ForeignKey, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.config import DEFAULT_EDUCATIONAL_USE_CONSENT_VERSION, get_settings
from app.database import Base

LEGACY_EDUCATIONAL_USE_CONSENT_VERSION = "legacy-unversioned"


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
    role: Mapped[str] = mapped_column(
        String(50), nullable=False, default="learner", server_default="learner"
    )  # learner, clinician_reviewer, admin
    reviewer_verification_status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="not_applicable",
        server_default="not_applicable",
    )  # not_applicable, pending, verified, suspended
    reviewer_practice_scope: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    reviewer_verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewer_verified_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    accepted_educational_use: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    accepted_educational_use_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    accepted_educational_use_version: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default=DEFAULT_EDUCATIONAL_USE_CONSENT_VERSION,
        server_default=LEGACY_EDUCATIONAL_USE_CONSENT_VERSION,
    )
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
    safety_events: Mapped[list["SafetyEvent"]] = relationship(
        "SafetyEvent",
        back_populates="user",
        foreign_keys="SafetyEvent.user_id",
        lazy="selectin",
    )
    clinical_case_reviews: Mapped[list["ClinicalCaseReview"]] = relationship(
        "ClinicalCaseReview", back_populates="reviewer", lazy="selectin"
    )

    @property
    def required_educational_use_consent_version(self) -> str:
        return get_settings().educational_use_consent_version

    @property
    def educational_use_consent_current(self) -> bool:
        return (
            self.accepted_educational_use
            and self.accepted_educational_use_version
            == self.required_educational_use_consent_version
        )

    @property
    def reviewer_credential_valid_until(self) -> datetime | None:
        if self.reviewer_verified_at is None:
            return None
        verified_at = self.reviewer_verified_at
        if verified_at.tzinfo is None:
            verified_at = verified_at.replace(tzinfo=timezone.utc)
        return verified_at + timedelta(
            days=get_settings().reviewer_credential_valid_days
        )

    @property
    def reviewer_credential_current(self) -> bool:
        valid_until = self.reviewer_credential_valid_until
        return bool(
            self.role == "clinician_reviewer"
            and self.reviewer_verification_status == "verified"
            and self.reviewer_practice_scope
            and self.reviewer_verified_by_user_id
            and valid_until
            and datetime.now(timezone.utc) <= valid_until
        )
