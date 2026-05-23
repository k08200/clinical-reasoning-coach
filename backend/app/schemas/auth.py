from __future__ import annotations

import uuid
from pydantic import BaseModel, EmailStr, field_validator


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    training_level: str = "medical_student"

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


class UserLogin(BaseModel):
    email: EmailStr
    password: str


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

    model_config = {"from_attributes": True}
