from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.user import User

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def _educational_use_consent_error(user: User) -> str | None:
    if not user.accepted_educational_use:
        return "Educational use consent required"
    if not user.educational_use_consent_current:
        return "Current educational use consent required"
    return None


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict[str, Any]) -> str:
    payload = dict(data)
    payload["exp"] = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload["type"] = "access"
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_refresh_token(data: dict[str, Any]) -> str:
    payload = dict(data)
    payload["exp"] = datetime.now(timezone.utc) + timedelta(
        days=settings.refresh_token_expire_days
    )
    payload["type"] = "refresh"
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e


def get_token_subject(token: str, expected_type: str) -> str:
    payload = decode_token(token)
    user_id = payload.get("sub")
    token_type = payload.get("type")
    if not user_id or token_type != expected_type:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id


async def get_current_user_id(token: str = Depends(oauth2_scheme)) -> str:
    return get_token_subject(token, "access")


async def get_current_user(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> User:
    import uuid as _uuid

    user = await db.get(User, _uuid.UUID(user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def require_educational_use_consent(
    user: User = Depends(get_current_user),
) -> str:
    consent_error = _educational_use_consent_error(user)
    if consent_error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=consent_error,
        )
    return str(user.id)


async def require_clinical_reviewer(
    user: User = Depends(get_current_user),
) -> User:
    consent_error = _educational_use_consent_error(user)
    if consent_error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=consent_error,
        )
    if user.role != "clinician_reviewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clinician reviewer role required",
        )
    if user.reviewer_verification_status != "verified":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clinician reviewer credential verification required",
        )
    if not user.reviewer_credential_current:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Clinician reviewer credential verification expired; "
                "administrator re-verification required"
            ),
        )
    return user


async def require_safety_reviewer(
    user: User = Depends(get_current_user),
) -> User:
    consent_error = _educational_use_consent_error(user)
    if consent_error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=consent_error,
        )
    if user.role not in {"clinician_reviewer", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clinician reviewer role required",
        )
    if user.role == "clinician_reviewer" and not user.reviewer_credential_current:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Clinician reviewer credential verification expired; "
                "administrator re-verification required"
            ),
        )
    return user


async def require_admin(
    user: User = Depends(get_current_user),
) -> User:
    consent_error = _educational_use_consent_error(user)
    if consent_error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=consent_error,
        )
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    return user
