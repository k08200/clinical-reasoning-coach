from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


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


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    training_level: str
    role: str
    accepted_educational_use: bool
    accepted_educational_use_at: datetime | None

    model_config = {"from_attributes": True}
