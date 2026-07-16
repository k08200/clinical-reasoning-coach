from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import (
    configured_provider_model,
    get_settings,
    model_release_approval_status,
)
from app.database import get_db
from app.models.case import ClinicalCase
from app.models.safety_event import SafetyEvent
from app.models.model_release_clinical_review import ModelReleaseClinicalReview
from app.models.user import User
from app.services.provider_factory import get_provider_readiness
from app.schemas.governance import (
    GovernanceCaseBlocker,
    GovernanceReadinessResponse,
    GovernanceReleaseBlocker,
    ModelReleaseClinicalReviewRequest,
    ModelReleaseClinicalReviewResponse,
)
from app.services.model_release_reviews import (
    current_model_release_clinical_reviews,
    required_model_release_clinical_reviewers,
)
from app.utils.auth import require_admin, require_clinical_reviewer

router = APIRouter(prefix="/api/governance", tags=["governance"])


@router.post(
    "/model-release-reviews",
    response_model=ModelReleaseClinicalReviewResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_model_release_clinical_review(
    body: ModelReleaseClinicalReviewRequest,
    reviewer: User = Depends(require_clinical_reviewer),
    db: AsyncSession = Depends(get_db),
) -> ModelReleaseClinicalReview:
    settings = get_settings()
    approved, detail = model_release_approval_status(settings)
    if not approved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "model_release_evaluation_not_current",
                "message": detail,
            },
        )
    existing = await db.scalar(
        select(ModelReleaseClinicalReview).where(
            ModelReleaseClinicalReview.provider == settings.llm_provider.lower(),
            ModelReleaseClinicalReview.model == configured_provider_model(settings),
            ModelReleaseClinicalReview.evaluation_sha256
            == settings.model_release_evaluation_sha256.strip().lower(),
            ModelReleaseClinicalReview.reviewer_user_id == reviewer.id,
        )
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This clinician has already reviewed the current model release.",
        )
    review = ModelReleaseClinicalReview(
        provider=settings.llm_provider.lower(),
        model=configured_provider_model(settings),
        evaluation_sha256=settings.model_release_evaluation_sha256.strip().lower(),
        reviewer_user_id=reviewer.id,
        practice_scope=body.practice_scope,
        confirmations={
            "output_safety_confirmed": body.output_safety_confirmed,
            "socratic_integrity_confirmed": body.socratic_integrity_confirmed,
            "latency_confirmed": body.latency_confirmed,
            "educational_use_only_confirmed": body.educational_use_only_confirmed,
        },
        review_notes=body.review_notes,
    )
    db.add(review)
    await db.flush()
    await db.refresh(review)
    return review


@router.get(
    "/model-release-reviews",
    response_model=list[ModelReleaseClinicalReviewResponse],
)
async def list_model_release_clinical_reviews(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[ModelReleaseClinicalReview]:
    return await current_model_release_clinical_reviews(db, get_settings())


def _case_blocker_reasons(provenance: dict) -> list[str]:
    reasons: list[str] = []
    if provenance["source_count"] < 1:
        reasons.append("No supporting clinical source")
    if provenance["review_status"] != "clinician_reviewed":
        reasons.append("Clinician review required")
    if provenance["review_content_changed"]:
        reasons.append("Case content changed after review")
    if provenance["review_date_invalid"]:
        reasons.append("Clinician review date is invalid")
    if provenance["review_stale"]:
        reasons.append("Clinician review is stale")
    if provenance["review_audit_missing"]:
        reasons.append("Clinical review audit is missing")
    if provenance["review_audit_incomplete"]:
        reasons.append("Clinical review audit is incomplete")
    if provenance["source_evidence_attestation_incomplete"]:
        reasons.append("Current source evidence attestation is incomplete")
    if provenance["reviewer_credential_verification_expired"]:
        reasons.append("Clinician reviewer credential verification is expired")
    if provenance["source_diversity_insufficient"]:
        reasons.append("Independent source diversity is insufficient")
    if not provenance["independent_review_requirement_met"]:
        reasons.append(
            "Independent clinician review requirement is not met "
            f"({provenance['independent_reviewer_count']}/"
            f"{provenance['required_independent_reviewers']})"
        )
    return reasons or [provenance["review_label"]]


@router.get("/readiness", response_model=GovernanceReadinessResponse)
async def get_governance_readiness(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> GovernanceReadinessResponse:
    cases = list(
        (
            await db.scalars(
                select(ClinicalCase).options(selectinload(ClinicalCase.clinical_reviews))
            )
        ).all()
    )
    case_blockers: list[GovernanceCaseBlocker] = []
    learner_eligible_case_count = 0
    for case in cases:
        provenance = case.source_provenance
        if provenance["requires_caution"]:
            case_blockers.append(
                GovernanceCaseBlocker(
                    case_id=case.id,
                    title=case.title,
                    reasons=_case_blocker_reasons(provenance),
                )
            )
        else:
            learner_eligible_case_count += 1

    open_safety_events = list(
        (
            await db.scalars(select(SafetyEvent).where(SafetyEvent.status == "open"))
        ).all()
    )
    open_high_risk_safety_event_count = sum(
        event.severity == "high" for event in open_safety_events
    )
    users = list((await db.scalars(select(User))).all())
    clinician_reviewers = [user for user in users if user.role == "clinician_reviewer"]
    verified_clinician_reviewer_count = sum(
        user.reviewer_credential_current for user in clinician_reviewers
    )
    expired_clinician_reviewer_count = sum(
        user.reviewer_verification_status == "verified"
        and not user.reviewer_credential_current
        for user in clinician_reviewers
    )
    pending_clinician_reviewer_count = sum(
        user.reviewer_verification_status == "pending" for user in clinician_reviewers
    )
    suspended_clinician_reviewer_count = sum(
        user.reviewer_verification_status == "suspended" for user in clinician_reviewers
    )
    consent_renewal_required_user_count = sum(
        not user.educational_use_consent_current for user in users
    )
    settings = get_settings()
    provider_readiness = await get_provider_readiness()
    model_release_approval_current, model_release_approval_detail = (
        model_release_approval_status(settings)
    )
    model_release_reviews = await current_model_release_clinical_reviews(db, settings)
    required_model_release_reviews = required_model_release_clinical_reviewers(settings)

    release_blockers: list[GovernanceReleaseBlocker] = []
    if learner_eligible_case_count == 0:
        release_blockers.append(
            GovernanceReleaseBlocker(
                code="no_learner_eligible_cases",
                count=0,
                message="No clinician-reviewed case currently meets learner release requirements.",
            )
        )
    if verified_clinician_reviewer_count == 0:
        release_blockers.append(
            GovernanceReleaseBlocker(
                code="no_currently_verified_clinician_reviewer",
                count=0,
                message=(
                    "At least one currently verified clinician reviewer is required "
                    "before learner release."
                ),
            )
        )
    if open_high_risk_safety_event_count:
        release_blockers.append(
            GovernanceReleaseBlocker(
                code="open_high_risk_safety_events",
                count=open_high_risk_safety_event_count,
                message="Open high-risk safety events require operational review before learner release.",
            )
        )
    if settings.app_environment.lower() == "production" and not provider_readiness.ready:
        release_blockers.append(
            GovernanceReleaseBlocker(
                code="clinical_coaching_provider_not_ready",
                count=0,
                message="The configured clinical coaching provider is not ready for learner release.",
            )
        )
    if (
        settings.app_environment.lower() == "production"
        and not model_release_approval_current
    ):
        release_blockers.append(
            GovernanceReleaseBlocker(
                code="model_release_approval_not_current",
                count=0,
                message="The configured clinical model has no current release approval.",
            )
        )
    if (
        settings.app_environment.lower() == "production"
        and len(model_release_reviews) < required_model_release_reviews
    ):
        release_blockers.append(
            GovernanceReleaseBlocker(
                code="model_release_independent_clinical_review_not_met",
                count=len(model_release_reviews),
                message=(
                    "The configured model release requires "
                    f"{required_model_release_reviews} distinct currently verified "
                    "clinician approvals."
                ),
            )
        )

    return GovernanceReadinessResponse(
        learner_eligible_case_count=learner_eligible_case_count,
        case_blocker_count=len(case_blockers),
        case_blockers=case_blockers,
        open_safety_event_count=len(open_safety_events),
        open_high_risk_safety_event_count=open_high_risk_safety_event_count,
        verified_clinician_reviewer_count=verified_clinician_reviewer_count,
        expired_clinician_reviewer_count=expired_clinician_reviewer_count,
        pending_clinician_reviewer_count=pending_clinician_reviewer_count,
        suspended_clinician_reviewer_count=suspended_clinician_reviewer_count,
        consent_renewal_required_user_count=consent_renewal_required_user_count,
        provider_ready=provider_readiness.ready,
        provider_verification=provider_readiness.verification,
        provider_detail=provider_readiness.detail,
        model_release_approval_current=model_release_approval_current,
        model_release_approval_detail=model_release_approval_detail,
        model_release_clinical_reviewer_count=len(model_release_reviews),
        required_model_release_clinical_reviewers=required_model_release_reviews,
        release_ready=not release_blockers,
        release_blockers=release_blockers,
    )
