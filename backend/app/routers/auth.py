from __future__ import annotations

import hmac
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.database import get_db
from app.models.case import ClinicalCase
from app.models.reviewer_credential_event import ReviewerCredentialEvent
from app.models.user import User
from app.schemas.auth import (
    AdminBootstrapRequest,
    EducationalUseConsentRequest,
    RefreshTokenRequest,
    ReviewerVerificationUpdateRequest,
    ReviewerCredentialEventResponse,
    UserRegister,
    UserRoleUpdateRequest,
    TokenResponse,
    UserResponse,
)
from app.utils.auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    get_token_subject,
    get_current_user,
    get_current_user_id,
    require_admin,
)
from app.services.rate_limit import enforce_rate_limit, request_client_identifier

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _invalidate_cases_reviewed_by(
    db: AsyncSession,
    reviewer_user_id,
) -> None:
    reviewed_cases = await db.scalars(
        select(ClinicalCase).where(
            ClinicalCase.reviewed_by_user_id == reviewer_user_id,
            ClinicalCase.review_status == "clinician_reviewed",
        )
    )
    for case in reviewed_cases:
        case.review_status = "educational_draft"
        case.last_reviewed_at = None
        case.reviewed_by_user_id = None
        case.review_notes = None


def _record_reviewer_credential_event(
    db: AsyncSession,
    *,
    reviewer_user_id,
    action: str,
    resulting_verification_status: str,
    practice_scope: str | None,
    verification_note: str,
    actioned_by_user_id,
) -> None:
    db.add(
        ReviewerCredentialEvent(
            reviewer_user_id=reviewer_user_id,
            action=action,
            resulting_verification_status=resulting_verification_status,
            practice_scope=practice_scope,
            verification_note=verification_note,
            actioned_by_user_id=actioned_by_user_id,
            created_at=datetime.now(timezone.utc),
        )
    )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    data: UserRegister,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    settings = get_settings()
    await enforce_rate_limit(
        bucket="auth-register",
        subject=request_client_identifier(request),
        maximum=settings.auth_registration_rate_limit_per_hour,
        window_seconds=60 * 60,
    )
    existing = await db.scalar(select(User).where(User.email == data.email))
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        training_level=data.training_level,
        accepted_educational_use=data.accepted_educational_use,
        accepted_educational_use_at=datetime.now(timezone.utc),
        accepted_educational_use_version=get_settings().educational_use_consent_version,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.post("/educational-use-consent", response_model=UserResponse)
async def accept_educational_use_consent(
    data: EducationalUseConsentRequest,
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

    user.accepted_educational_use = data.accepted_educational_use
    user.accepted_educational_use_at = datetime.now(timezone.utc)
    user.accepted_educational_use_version = get_settings().educational_use_consent_version

    await db.flush()
    await db.refresh(user)
    return user


@router.post("/token", response_model=TokenResponse)
async def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    settings = get_settings()
    await enforce_rate_limit(
        bucket="auth-login",
        subject=request_client_identifier(request),
        maximum=settings.auth_login_rate_limit_per_minute,
        window_seconds=60,
    )
    user = await db.scalar(select(User).where(User.email == form.username))
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token_data = {"sub": str(user.id)}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    data: RefreshTokenRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    settings = get_settings()
    await enforce_rate_limit(
        bucket="auth-refresh",
        subject=request_client_identifier(request),
        maximum=settings.auth_refresh_rate_limit_per_minute,
        window_seconds=60,
    )
    user_id = get_token_subject(data.refresh_token, "refresh")

    import uuid as _uuid

    user = await db.get(User, _uuid.UUID(user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token_data = {"sub": str(user.id)}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> User:
    import uuid as _uuid
    user = await db.get(User, _uuid.UUID(user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.post("/admin/bootstrap", response_model=UserResponse)
async def bootstrap_first_admin(
    data: AdminBootstrapRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    settings = get_settings()
    expected_token = settings.admin_bootstrap_token.strip()
    if not expected_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin bootstrap is not configured",
        )

    if not user.educational_use_consent_current:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Current educational use consent required",
        )

    if not hmac.compare_digest(data.setup_token, expected_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin bootstrap token",
        )

    existing_admin = await db.scalar(select(User).where(User.role == "admin").limit(1))
    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Admin user already exists",
        )

    user.role = "admin"
    await db.flush()
    await db.refresh(user)
    return user


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[User]:
    result = await db.scalars(select(User).order_by(User.created_at.desc(), User.email.asc()))
    return list(result)


@router.patch("/users/{user_id}/role", response_model=UserResponse)
async def update_user_role(
    user_id: str,
    data: UserRoleUpdateRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> User:
    import uuid as _uuid

    try:
        target_id = _uuid.UUID(user_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        ) from e

    target = await db.get(User, target_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target.id == admin.id and data.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove your own admin role",
        )

    previous_role = target.role
    role_changed = previous_role != data.role
    invalidates_active_reviews = (
        previous_role == "clinician_reviewer" and data.role != "clinician_reviewer"
    )
    target.role = data.role
    if role_changed and data.role == "clinician_reviewer":
        target.reviewer_verification_status = "pending"
        target.reviewer_practice_scope = None
        target.reviewer_verified_at = None
        target.reviewer_verified_by_user_id = None
        _record_reviewer_credential_event(
            db,
            reviewer_user_id=target.id,
            action="role_assigned",
            resulting_verification_status="pending",
            practice_scope=None,
            verification_note="Reviewer role assigned by administrator; credential verification pending.",
            actioned_by_user_id=admin.id,
        )
    elif role_changed:
        target.reviewer_verification_status = "not_applicable"
        target.reviewer_practice_scope = None
        target.reviewer_verified_at = None
        target.reviewer_verified_by_user_id = None
    if invalidates_active_reviews:
        await _invalidate_cases_reviewed_by(db, target.id)
        _record_reviewer_credential_event(
            db,
            reviewer_user_id=target.id,
            action="role_removed",
            resulting_verification_status="not_applicable",
            practice_scope=None,
            verification_note="Reviewer role removed by administrator; approved cases require re-review.",
            actioned_by_user_id=admin.id,
        )
    await db.flush()
    await db.refresh(target)
    return target


@router.patch("/users/{user_id}/reviewer-verification", response_model=UserResponse)
async def update_reviewer_verification(
    user_id: str,
    data: ReviewerVerificationUpdateRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> User:
    import uuid as _uuid

    try:
        target_id = _uuid.UUID(user_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        ) from e

    target = await db.get(User, target_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrators cannot verify their own clinician credentials",
        )
    if target.role != "clinician_reviewer":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only clinician reviewers can receive credential verification",
        )

    target.reviewer_verification_status = data.status
    if data.status == "verified":
        target.reviewer_practice_scope = data.practice_scope
        target.reviewer_verified_at = datetime.now(timezone.utc)
        target.reviewer_verified_by_user_id = admin.id
    else:
        target.reviewer_practice_scope = None
        target.reviewer_verified_at = None
        target.reviewer_verified_by_user_id = None
        await _invalidate_cases_reviewed_by(db, target.id)

    _record_reviewer_credential_event(
        db,
        reviewer_user_id=target.id,
        action=("credentials_verified" if data.status == "verified" else "credentials_suspended"),
        resulting_verification_status=data.status,
        practice_scope=target.reviewer_practice_scope,
        verification_note=data.verification_note,
        actioned_by_user_id=admin.id,
    )

    await db.flush()
    await db.refresh(target)
    return target


@router.get(
    "/users/{user_id}/reviewer-verification/history",
    response_model=list[ReviewerCredentialEventResponse],
)
async def list_reviewer_verification_history(
    user_id: str,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[ReviewerCredentialEvent]:
    import uuid as _uuid

    try:
        target_id = _uuid.UUID(user_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        ) from e

    target = await db.get(User, target_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    events = await db.scalars(
        select(ReviewerCredentialEvent)
        .where(ReviewerCredentialEvent.reviewer_user_id == target.id)
        .order_by(ReviewerCredentialEvent.created_at.desc())
    )
    return list(events)
