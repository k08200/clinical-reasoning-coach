from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

VALID_USER_ROLES = {"learner", "clinician_reviewer", "admin"}
VALID_REVIEWER_VERIFICATION_STATUSES = {"verified", "suspended"}


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    training_level: str = "medical_student"
    accepted_educational_use: bool = Field(
        default=False,
        validate_default=True,
        description="User confirms the product is educational only, not patient care.",
    )

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("training_level")
    @classmethod
    def valid_level(cls, v: str) -> str:
        valid = {"medical_student", "intern", "resident", "fellow"}
        if v not in valid:
            raise ValueError(f"training_level must be one of {valid}")
        return v

    @field_validator("accepted_educational_use")
    @classmethod
    def require_educational_use_acceptance(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError(
                "You must confirm this product is for educational simulation only "
                "and not for real patient care or emergencies."
            )
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class EducationalUseConsentRequest(BaseModel):
    accepted_educational_use: bool = Field(
        default=False,
        validate_default=True,
        description="User confirms the product is educational only, not patient care.",
    )

    @field_validator("accepted_educational_use")
    @classmethod
    def require_educational_use_acceptance(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError(
                "You must confirm this product is for educational simulation only "
                "and not for real patient care or emergencies."
            )
        return v


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class AdminBootstrapRequest(BaseModel):
    setup_token: str = Field(min_length=1, max_length=500)


class UserRoleUpdateRequest(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in VALID_USER_ROLES:
            raise ValueError(f"role must be one of {VALID_USER_ROLES}")
        return v


class ReviewerVerificationUpdateRequest(BaseModel):
    status: str
    practice_scope: str | None = Field(default=None, max_length=200)
    verification_note: str = Field(max_length=1000)

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: str) -> str:
        if v not in VALID_REVIEWER_VERIFICATION_STATUSES:
            raise ValueError(
                f"status must be one of {VALID_REVIEWER_VERIFICATION_STATUSES}"
            )
        return v

    @field_validator("practice_scope")
    @classmethod
    def normalize_practice_scope(cls, v: str | None) -> str | None:
        if v is None:
            return None
        scope = v.strip()
        return scope or None

    @field_validator("verification_note")
    @classmethod
    def require_verification_note(cls, v: str) -> str:
        note = v.strip()
        if len(note) < 10:
            raise ValueError("Credential verification note must be at least 10 characters")
        return note

    @model_validator(mode="after")
    def require_scope_for_verified_reviewer(self) -> "ReviewerVerificationUpdateRequest":
        if self.status == "verified" and (
            not self.practice_scope or len(self.practice_scope) < 3
        ):
            raise ValueError("Verified clinician reviewers require a practice scope")
        return self


class ReviewerCredentialEventResponse(BaseModel):
    id: uuid.UUID
    reviewer_user_id: uuid.UUID
    action: str
    resulting_verification_status: str
    practice_scope: str | None
    verification_note: str
    actioned_by_user_id: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    training_level: str
    role: str
    reviewer_verification_status: str
    reviewer_practice_scope: str | None
    reviewer_verified_at: datetime | None
    reviewer_verified_by_user_id: uuid.UUID | None
    accepted_educational_use: bool
    accepted_educational_use_at: datetime | None
    accepted_educational_use_version: str
    required_educational_use_consent_version: str
    educational_use_consent_current: bool

    model_config = {"from_attributes": True}
