from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.case import ClinicalCase
from app.schemas.case import ClinicalCaseResponse, GenerateCaseRequest
from app.services.case_generator import generate_clinical_case, generate_demo_case
from app.utils.auth import get_current_user_id

router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.post("/generate", response_model=ClinicalCaseResponse, status_code=status.HTTP_201_CREATED)
async def generate_case(
    body: GenerateCaseRequest,
    _user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> ClinicalCase:
    """Dynamically generate a new clinical case using Claude with extended thinking."""
    case_data = await generate_clinical_case(
        specialty=body.specialty,
        difficulty=body.difficulty,
        seed_scenario=body.seed_scenario,
    )

    case = ClinicalCase(**case_data.model_dump())
    db.add(case)
    await db.flush()
    await db.refresh(case)
    return case


@router.post("/generate/demo", response_model=ClinicalCaseResponse, status_code=status.HTTP_201_CREATED)
async def generate_demo(
    _user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> ClinicalCase:
    """Generate the canonical demo case: 58yo male chest pain + diaphoresis."""
    case_data = await generate_demo_case()
    case = ClinicalCase(**case_data.model_dump())
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
    _user_id: str = Depends(get_current_user_id),
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


@router.get("/{case_id}", response_model=ClinicalCaseResponse)
async def get_case(
    case_id: uuid.UUID,
    _user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> ClinicalCase:
    case = await db.get(ClinicalCase, case_id)
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    return case
