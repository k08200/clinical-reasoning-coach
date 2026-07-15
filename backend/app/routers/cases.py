from __future__ import annotations

import uuid
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.case import ClinicalCase, clinical_case_content_fingerprint
from app.models.case_review import ClinicalCaseReview
from app.models.user import User
from app.schemas.case import (
    ClinicalCaseResponse,
    ClinicalCaseReviewDetailResponse,
    ClinicalCaseReviewResponse,
    ClinicalReviewRequest,
    GenerateCaseRequest,
)
from app.services.case_generator import generate_clinical_case, generate_demo_case
from app.services.case_quality import evaluate_case_quality
from app.services.privacy_guard import detect_patient_identifiers
from app.services.socratic_coach import detect_real_patient_signals
from app.utils.auth import require_clinical_reviewer, require_educational_use_consent

router = APIRouter(prefix="/api/cases", tags=["cases"])

CASE_QUALITY_FIELDS = (
    "title",
    "specialty",
    "difficulty",
    "chief_complaint",
    "patient_demographics",
    "history_of_present_illness",
    "past_medical_history",
    "medications",
    "physical_exam",
    "initial_labs",
    "diagnosis",
    "key_teaching_points",
    "cognitive_traps",
    "clinical_red_flags",
    "time_critical_actions",
    "contraindication_checks",
    "clinical_sources",
    "coach_guidance",
)


def _quality_payload_for_clinical_review(case: ClinicalCase) -> dict:
    payload = {field: getattr(case, field) for field in CASE_QUALITY_FIELDS}
    payload["review_status"] = "clinician_reviewed"
    payload["last_reviewed_at"] = date.today().isoformat()
    return payload


def _assert_generated_case_quality(case_payload: dict) -> None:
    quality_report = evaluate_case_quality(case_payload)
    if quality_report.passed:
        return

    issues = quality_report.critical_issues + quality_report.warnings
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=_case_quality_gate_detail(
            code="generated_case_quality_gate_failed",
            message="Generated case blocked by case quality gate",
            issues=issues,
        ),
    )


def _case_quality_gate_detail(
    *,
    code: str,
    message: str,
    issues: list[str],
) -> dict:
    return {
        "code": code,
        "message": message,
        "issues": issues,
    }


def _assert_seed_scenario_safe(seed_scenario: str | None) -> None:
    if not seed_scenario:
        return

    patient_identifiers = detect_patient_identifiers(seed_scenario)
    if patient_identifiers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "seed_scenario_contains_patient_identifiers",
                "message": (
                    "Seed scenarios must be de-identified educational prompts. "
                    "Remove patient identifiers before generating a case."
                ),
                "detected_identifier_categories": patient_identifiers,
            },
        )

    if detect_real_patient_signals(seed_scenario):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "seed_scenario_real_patient_or_emergency",
                "message": (
                    "Seed scenarios must not describe an active real patient or "
                    "emergency. Use only clearly simulated educational prompts."
                ),
            },
        )


@router.post("/generate", response_model=ClinicalCaseResponse, status_code=status.HTTP_201_CREATED)
async def generate_case(
    body: GenerateCaseRequest,
    _user_id: str = Depends(require_educational_use_consent),
    db: AsyncSession = Depends(get_db),
) -> ClinicalCase:
    """Dynamically generate a new clinical case using Claude with extended thinking."""
    if not body.acknowledge_unreviewed_generation:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Dynamic AI-generated cases are unreviewed educational drafts. "
                "Set acknowledge_unreviewed_generation=true to create one."
            ),
        )

    _assert_seed_scenario_safe(body.seed_scenario)

    case_data = await generate_clinical_case(
        specialty=body.specialty,
        difficulty=body.difficulty,
        seed_scenario=body.seed_scenario,
    )

    case_payload = case_data.model_dump()
    case_payload["review_status"] = "ai_generated_unreviewed"
    case_payload["last_reviewed_at"] = None
    _assert_generated_case_quality(case_payload)
    case = ClinicalCase(**case_payload)
    db.add(case)
    await db.flush()
    await db.refresh(case)
    return case


@router.post("/generate/demo", response_model=ClinicalCaseResponse, status_code=status.HTTP_201_CREATED)
async def generate_demo(
    _user_id: str = Depends(require_educational_use_consent),
    db: AsyncSession = Depends(get_db),
) -> ClinicalCase:
    """Generate the canonical demo case: 58yo male chest pain + diaphoresis."""
    case_data = await generate_demo_case()
    case_payload = case_data.model_dump()
    _assert_generated_case_quality(case_payload)
    case = ClinicalCase(**case_payload)
    db.add(case)
    await db.flush()
    await db.refresh(case)
    return case


@router.get("", response_model=list[ClinicalCaseResponse])
async def list_cases(
    specialty: str | None = Query(None),
    difficulty: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _user_id: str = Depends(require_educational_use_consent),
    db: AsyncSession = Depends(get_db),
) -> list[ClinicalCase]:
    query = select(ClinicalCase)
    if specialty:
        query = query.where(ClinicalCase.specialty == specialty)
    if difficulty:
        query = query.where(ClinicalCase.difficulty == difficulty)
    query = query.order_by(ClinicalCase.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("/{case_id}/clinical-review", response_model=ClinicalCaseResponse)
async def complete_clinical_review(
    case_id: uuid.UUID,
    body: ClinicalReviewRequest,
    reviewer: User = Depends(require_clinical_reviewer),
    db: AsyncSession = Depends(get_db),
) -> ClinicalCase:
    case = await db.get(ClinicalCase, case_id)
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    if not case.clinical_sources:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Clinical review requires at least one supporting clinical source",
        )
    case_source_urls = {
        str(source.get("url")).strip()
        for source in case.clinical_sources
        if isinstance(source, dict) and str(source.get("url") or "").strip()
    }
    attested_source_urls = set(body.source_evidence_attestation.source_urls)
    if not case_source_urls or attested_source_urls != case_source_urls:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Source evidence attestation must include every current clinical "
                "source URL exactly once"
            ),
        )
    if body.source_evidence_attestation.verified_on < date.today() - timedelta(days=7):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Source evidence verification must be dated within the last 7 days",
        )
    quality_report = evaluate_case_quality(_quality_payload_for_clinical_review(case))
    if not quality_report.passed:
        issues = quality_report.critical_issues + quality_report.warnings
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_case_quality_gate_detail(
                code="clinical_review_quality_gate_failed",
                message="Clinical review blocked by case quality gate",
                issues=issues,
            ),
        )

    prior_review_status = case.review_status
    source_organizations = []
    seen = set()
    for source in case.clinical_sources:
        organization = source.get("organization")
        if organization and organization not in seen:
            source_organizations.append(organization)
            seen.add(organization)

    case.review_status = "clinician_reviewed"
    case.last_reviewed_at = date.today().isoformat()
    case.reviewed_by_user_id = reviewer.id
    case.review_notes = body.review_notes.strip() if body.review_notes else None
    db.add(
        ClinicalCaseReview(
            case_id=case.id,
            reviewer_user_id=reviewer.id,
            prior_review_status=prior_review_status,
            resulting_review_status="clinician_reviewed",
            confirmations={
                "clinical_accuracy_confirmed": body.clinical_accuracy_confirmed,
                "source_alignment_confirmed": body.source_alignment_confirmed,
                "educational_safety_confirmed": body.educational_safety_confirmed,
            },
            source_snapshot={
                "source_count": len(case.clinical_sources),
                "organizations": source_organizations,
                "case_content_fingerprint": clinical_case_content_fingerprint(case),
                "alignment_checklist": body.source_alignment_checks.model_dump(),
                "reviewer_attestation": {
                    **body.reviewer_attestation.model_dump(),
                    "reviewer_role": reviewer.role,
                },
                "source_evidence_attestation": body.source_evidence_attestation.model_dump(
                    mode="json"
                ),
                "reviewer_credential_verification": {
                    "status": reviewer.reviewer_verification_status,
                    "practice_scope": reviewer.reviewer_practice_scope,
                    "verified_at": reviewer.reviewer_verified_at.isoformat()
                    if reviewer.reviewer_verified_at
                    else None,
                    "verified_by_user_id": str(reviewer.reviewer_verified_by_user_id)
                    if reviewer.reviewer_verified_by_user_id
                    else None,
                },
                "supported_elements": [
                    {
                        "title": source.get("title"),
                        "organization": source.get("organization"),
                        "supports": source.get("supports") or [],
                    }
                    for source in case.clinical_sources
                ],
            },
            review_notes=case.review_notes,
        )
    )

    await db.flush()
    await db.refresh(case)
    return case


@router.get(
    "/{case_id}/clinical-review/detail",
    response_model=ClinicalCaseReviewDetailResponse,
)
async def get_clinical_review_detail(
    case_id: uuid.UUID,
    _reviewer: User = Depends(require_clinical_reviewer),
    db: AsyncSession = Depends(get_db),
) -> ClinicalCase:
    case = await db.get(ClinicalCase, case_id)
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    return case


@router.get(
    "/{case_id}/clinical-review/history",
    response_model=list[ClinicalCaseReviewResponse],
)
async def list_clinical_review_history(
    case_id: uuid.UUID,
    _reviewer: User = Depends(require_clinical_reviewer),
    db: AsyncSession = Depends(get_db),
) -> list[ClinicalCaseReview]:
    case = await db.get(ClinicalCase, case_id)
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")

    result = await db.execute(
        select(ClinicalCaseReview)
        .where(ClinicalCaseReview.case_id == case_id)
        .order_by(ClinicalCaseReview.created_at.desc())
    )
    return list(result.scalars().all())


@router.get("/{case_id}", response_model=ClinicalCaseResponse)
async def get_case(
    case_id: uuid.UUID,
    _user_id: str = Depends(require_educational_use_consent),
    db: AsyncSession = Depends(get_db),
) -> ClinicalCase:
    case = await db.get(ClinicalCase, case_id)
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    return case
