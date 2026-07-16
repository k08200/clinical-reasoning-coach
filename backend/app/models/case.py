from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, datetime, timedelta
from typing import Optional
from sqlalchemy import ForeignKey, String, Text, DateTime, Integer, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.config import get_settings
from app.database import Base

CLINICAL_REVIEW_VALID_DAYS = 365
SOURCE_EVIDENCE_VALID_DAYS = 7
MIN_REVIEWED_SOURCE_ORGANIZATIONS = 2
CLINICAL_REVIEW_CONTENT_FIELDS = (
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
REQUIRED_REVIEW_CONFIRMATION_FIELDS = (
    "clinical_accuracy_confirmed",
    "source_alignment_confirmed",
    "educational_safety_confirmed",
)
REQUIRED_SOURCE_ALIGNMENT_FIELDS = (
    "teaching_points_supported",
    "red_flags_supported",
    "time_critical_actions_supported",
    "contraindication_checks_supported",
)
REQUIRED_REVIEWER_ATTESTATION_FIELDS = (
    "attests_review_within_scope",
    "attests_educational_use_only",
)

REVIEW_PROVENANCE = {
    "clinician_reviewed": {
        "label": "Clinician reviewed",
        "requires_caution": False,
    },
    "educational_draft": {
        "label": "Educational draft",
        "requires_caution": True,
    },
    "ai_generated_unreviewed": {
        "label": "AI-generated, unreviewed",
        "requires_caution": True,
    },
}


def _parse_review_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def clinical_case_content_fingerprint(case: "ClinicalCase") -> str:
    payload = {
        field: getattr(case, field)
        for field in CLINICAL_REVIEW_CONTENT_FIELDS
    }
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _review_audit_confirms_required_items(
    review: "ClinicalCaseReview",
    case: "ClinicalCase",
) -> bool:
    confirmations = review.confirmations if isinstance(review.confirmations, dict) else {}
    if not all(confirmations.get(field) is True for field in REQUIRED_REVIEW_CONFIRMATION_FIELDS):
        return False

    source_snapshot = review.source_snapshot if isinstance(review.source_snapshot, dict) else {}
    alignment_checklist = source_snapshot.get("alignment_checklist")
    if not isinstance(alignment_checklist, dict):
        return False
    if not all(
        alignment_checklist.get(field) is True
        for field in REQUIRED_SOURCE_ALIGNMENT_FIELDS
    ):
        return False

    reviewer_attestation = source_snapshot.get("reviewer_attestation")
    if not isinstance(reviewer_attestation, dict):
        return False
    if not isinstance(reviewer_attestation.get("practice_scope"), str):
        return False
    if len(reviewer_attestation["practice_scope"].strip()) < 3:
        return False
    return (
        all(
            reviewer_attestation.get(field) is True
            for field in REQUIRED_REVIEWER_ATTESTATION_FIELDS
        )
        and _review_audit_has_verified_reviewer_credentials(source_snapshot)
        and _review_audit_has_source_evidence_attestation(source_snapshot, case)
    )


def _review_audit_has_verified_reviewer_credentials(source_snapshot: dict) -> bool:
    verification = source_snapshot.get("reviewer_credential_verification")
    if not isinstance(verification, dict):
        return False
    if verification.get("status") != "verified":
        return False
    if not isinstance(verification.get("practice_scope"), str):
        return False
    if len(verification["practice_scope"].strip()) < 3:
        return False
    verified_on = _parse_review_date(verification.get("verified_at"))
    if verified_on is None:
        return False
    return (
        bool(verification.get("verified_by_user_id"))
        and date.today()
        <= verified_on + timedelta(days=get_settings().reviewer_credential_valid_days)
    )


def _review_audit_reviewer_credentials_expired(source_snapshot: dict) -> bool:
    verification = source_snapshot.get("reviewer_credential_verification")
    if not isinstance(verification, dict) or verification.get("status") != "verified":
        return False
    verified_on = _parse_review_date(verification.get("verified_at"))
    return bool(
        verified_on
        and date.today()
        > verified_on + timedelta(days=get_settings().reviewer_credential_valid_days)
    )


def _review_audit_has_source_evidence_attestation(
    source_snapshot: dict,
    case: "ClinicalCase",
) -> bool:
    attestation = source_snapshot.get("source_evidence_attestation")
    if not isinstance(attestation, dict):
        return False
    if not (
        attestation.get("attests_sources_accessed") is True
        and attestation.get("attests_sources_current") is True
    ):
        return False
    verified_on = _parse_review_date(attestation.get("verified_on"))
    if (
        verified_on is None
        or verified_on > date.today()
        or verified_on < date.today() - timedelta(days=SOURCE_EVIDENCE_VALID_DAYS)
    ):
        return False
    source_urls = attestation.get("source_urls")
    if not isinstance(source_urls, list) or not source_urls:
        return False
    attested_urls = [
        url.strip() for url in source_urls if isinstance(url, str) and url.strip()
    ]
    case_urls = [
        str(source.get("url")).strip()
        for source in case.clinical_sources or []
        if isinstance(source, dict) and str(source.get("url") or "").strip()
    ]
    return (
        len(attested_urls) == len(source_urls)
        and len(set(attested_urls)) == len(attested_urls)
        and set(attested_urls) == set(case_urls)
    )


def _qualified_independent_reviewer_ids(case: "ClinicalCase") -> set[str]:
    current_fingerprint = clinical_case_content_fingerprint(case)
    reviewer_ids: set[str] = set()
    for review in case.clinical_reviews or []:
        source_snapshot = (
            review.source_snapshot if isinstance(review.source_snapshot, dict) else {}
        )
        if (
            review.resulting_review_status != "clinician_reviewed"
            or source_snapshot.get("case_content_fingerprint") != current_fingerprint
            or not _review_audit_confirms_required_items(review, case)
        ):
            continue
        reviewer_ids.add(str(review.reviewer_user_id))
    return reviewer_ids


class ClinicalCase(Base):
    __tablename__ = "clinical_cases"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    specialty: Mapped[str] = mapped_column(String(100), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(50), nullable=False, default="medium")
    chief_complaint: Mapped[str] = mapped_column(Text, nullable=False)
    patient_demographics: Mapped[dict] = mapped_column(JSON, nullable=False)
    history_of_present_illness: Mapped[str] = mapped_column(Text, nullable=False)
    past_medical_history: Mapped[str] = mapped_column(Text, nullable=False)
    medications: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    physical_exam: Mapped[dict] = mapped_column(JSON, nullable=False)
    initial_labs: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    diagnosis: Mapped[str] = mapped_column(String(500), nullable=False)
    key_teaching_points: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    cognitive_traps: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    clinical_red_flags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    time_critical_actions: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    contraindication_checks: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    clinical_sources: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    review_status: Mapped[str] = mapped_column(String(50), nullable=False, default="educational_draft")
    last_reviewed_at: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    reviewed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Hidden from students — only used by AI coach
    coach_guidance: Mapped[str] = mapped_column(Text, nullable=False)
    times_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    sessions: Mapped[list["CoachingSession"]] = relationship(
        "CoachingSession", back_populates="case", lazy="selectin"
    )
    clinical_reviews: Mapped[list["ClinicalCaseReview"]] = relationship(
        "ClinicalCaseReview", back_populates="case", lazy="selectin"
    )

    @property
    def source_provenance(self) -> dict:
        organizations = []
        seen = set()
        for source in self.clinical_sources or []:
            organization = source.get("organization")
            if organization and organization not in seen:
                organizations.append(organization)
                seen.add(organization)

        review = REVIEW_PROVENANCE.get(
            self.review_status,
            {
                "label": "Review status unknown",
                "requires_caution": True,
            },
        )
        reviewed_on = _parse_review_date(self.last_reviewed_at)
        today = date.today()
        review_date_invalid = (
            self.review_status == "clinician_reviewed"
            and bool(self.last_reviewed_at)
            and (reviewed_on is None or reviewed_on > today)
        )
        review_valid_until = (
            (reviewed_on + timedelta(days=CLINICAL_REVIEW_VALID_DAYS)).isoformat()
            if reviewed_on and not review_date_invalid
            else None
        )
        review_stale = (
            self.review_status == "clinician_reviewed"
            and (
                reviewed_on is None
                or today > reviewed_on + timedelta(days=CLINICAL_REVIEW_VALID_DAYS)
            )
        )
        review_label = review["label"]
        requires_caution = review["requires_caution"]
        latest_review = max(
            self.clinical_reviews or [],
            key=lambda item: item.created_at or datetime.min,
            default=None,
        )
        review_fingerprint = (
            latest_review.source_snapshot.get("case_content_fingerprint")
            if latest_review and isinstance(latest_review.source_snapshot, dict)
            else None
        )
        review_audit_missing = (
            self.review_status == "clinician_reviewed"
            and not bool(review_fingerprint)
        )
        review_audit_incomplete = (
            self.review_status == "clinician_reviewed"
            and bool(review_fingerprint)
            and latest_review is not None
            and not _review_audit_confirms_required_items(latest_review, self)
        )
        source_evidence_attestation_incomplete = (
            self.review_status == "clinician_reviewed"
            and latest_review is not None
            and not _review_audit_has_source_evidence_attestation(
                latest_review.source_snapshot
                if isinstance(latest_review.source_snapshot, dict)
                else {},
                self,
            )
        )
        reviewer_credential_verification_expired = (
            self.review_status == "clinician_reviewed"
            and latest_review is not None
            and _review_audit_reviewer_credentials_expired(
                latest_review.source_snapshot
                if isinstance(latest_review.source_snapshot, dict)
                else {}
            )
        )
        source_diversity_insufficient = (
            self.review_status == "clinician_reviewed"
            and len(organizations) < MIN_REVIEWED_SOURCE_ORGANIZATIONS
        )
        review_content_changed = (
            self.review_status == "clinician_reviewed"
            and bool(review_fingerprint)
            and review_fingerprint != clinical_case_content_fingerprint(self)
        )
        required_independent_reviewers = (
            get_settings().clinical_review_minimum_distinct_reviewers
        )
        independent_reviewer_count = len(_qualified_independent_reviewer_ids(self))
        independent_review_requirement_met = (
            self.review_status == "clinician_reviewed"
            and independent_reviewer_count >= required_independent_reviewers
        )
        if review_audit_missing:
            review_label = "Clinician review audit missing"
            requires_caution = True
        if review_audit_incomplete:
            review_label = "Clinician review audit incomplete"
            requires_caution = True
        if source_evidence_attestation_incomplete:
            review_label = "Clinician review source evidence incomplete"
            requires_caution = True
        if reviewer_credential_verification_expired:
            review_label = "Clinician reviewer credential verification expired"
            requires_caution = True
        if source_diversity_insufficient:
            review_label = "Clinician review source diversity insufficient"
            requires_caution = True
        if review_stale:
            review_label = "Clinician review stale"
            requires_caution = True
        if review_date_invalid:
            review_label = "Clinician review date invalid"
            requires_caution = True
        if review_content_changed:
            review_label = "Clinician review content changed"
            requires_caution = True
        if (
            self.review_status == "clinician_reviewed"
            and not independent_review_requirement_met
            and not requires_caution
        ):
            review_label = "Independent clinician review requirement not met"
            requires_caution = True

        return {
            "source_count": len(self.clinical_sources or []),
            "organizations": organizations,
            "review_status": self.review_status,
            "review_label": review_label,
            "requires_caution": requires_caution,
            "last_reviewed_at": self.last_reviewed_at,
            "review_valid_until": review_valid_until,
            "review_stale": review_stale,
            "review_date_invalid": review_date_invalid,
            "review_audit_missing": review_audit_missing,
            "review_audit_incomplete": review_audit_incomplete,
            "source_evidence_attestation_incomplete": (
                source_evidence_attestation_incomplete
            ),
            "reviewer_credential_verification_expired": (
                reviewer_credential_verification_expired
            ),
            "source_diversity_insufficient": source_diversity_insufficient,
            "review_content_changed": review_content_changed,
            "independent_reviewer_count": independent_reviewer_count,
            "required_independent_reviewers": required_independent_reviewers,
            "independent_review_requirement_met": independent_review_requirement_met,
        }
