"""
Clinical case quality gate.

This does not certify medical correctness. It prevents obviously incomplete or
unsafe educational cases from entering the coaching flow without clinician review.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from app.schemas.case import ClinicalCaseCreate

MIN_PASSING_SCORE = 85
ALLOWED_REVIEW_STATUSES = {
    "ai_generated_unreviewed",
    "educational_draft",
    "clinician_reviewed",
}
PLACEHOLDER_SOURCE_HOSTS = {
    "example.com",
    "example.org",
    "example.net",
    "example.test",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
}


@dataclass
class CaseQualityReport:
    score: int = 100
    critical_issues: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.critical_issues and self.score >= MIN_PASSING_SCORE

    def add_critical(self, message: str, penalty: int = 15) -> None:
        self.critical_issues.append(message)
        self.score = max(0, self.score - penalty)

    def add_warning(self, message: str, penalty: int = 5) -> None:
        self.warnings.append(message)
        self.score = max(0, self.score - penalty)


def evaluate_case_quality(case: ClinicalCaseCreate | dict[str, Any]) -> CaseQualityReport:
    data = case.model_dump() if isinstance(case, ClinicalCaseCreate) else case
    report = CaseQualityReport()

    _check_required_narrative(data, report)
    _check_demographics(data, report)
    _check_vitals(data, report)
    _check_exam_sections(data, report)
    _check_education_metadata(data, report)
    _check_safety_metadata(data, report)
    _check_source_metadata(data, report)
    _check_review_metadata(data, report)
    _check_coach_guidance(data, report)

    return report


def assert_case_quality(case: ClinicalCaseCreate | dict[str, Any]) -> None:
    report = evaluate_case_quality(case)
    if report.passed:
        return
    details = "; ".join(report.critical_issues + report.warnings)
    raise ValueError(f"Clinical case quality gate failed: {details}")


def _check_required_narrative(data: dict[str, Any], report: CaseQualityReport) -> None:
    required = [
        "title",
        "specialty",
        "difficulty",
        "chief_complaint",
        "history_of_present_illness",
        "past_medical_history",
        "diagnosis",
        "coach_guidance",
    ]
    for field_name in required:
        if not str(data.get(field_name, "")).strip():
            report.add_critical(f"missing {field_name}")


def _check_demographics(data: dict[str, Any], report: CaseQualityReport) -> None:
    demographics = data.get("patient_demographics") or {}
    age = demographics.get("age")
    sex = str(demographics.get("sex", "")).lower()
    if not isinstance(age, int) or not 0 < age < 120:
        report.add_critical("patient_demographics.age must be a realistic integer")
    if sex not in {"male", "female"}:
        report.add_critical("patient_demographics.sex must be male or female")


def _check_vitals(data: dict[str, Any], report: CaseQualityReport) -> None:
    vitals = (data.get("physical_exam") or {}).get("vitals") or {}
    if not str(vitals.get("bp", "")).strip():
        report.add_critical("vitals.bp is required")
    _check_range(vitals.get("hr"), 20, 250, "vitals.hr", report)
    _check_range(vitals.get("rr"), 4, 80, "vitals.rr", report)
    _check_range(vitals.get("temp_c"), 25, 45, "vitals.temp_c", report)
    _check_range(vitals.get("spo2"), 40, 100, "vitals.spo2", report)


def _check_range(
    value: Any,
    lower: float,
    upper: float,
    label: str,
    report: CaseQualityReport,
) -> None:
    if not isinstance(value, (int, float)) or not lower <= value <= upper:
        report.add_critical(f"{label} must be between {lower:g} and {upper:g}")


def _check_exam_sections(data: dict[str, Any], report: CaseQualityReport) -> None:
    exam = data.get("physical_exam") or {}
    for section in ("general", "cardiovascular", "pulmonary", "abdomen", "neuro"):
        if not str(exam.get(section, "")).strip():
            report.add_critical(f"physical_exam.{section} is required")


def _check_education_metadata(data: dict[str, Any], report: CaseQualityReport) -> None:
    if len(data.get("key_teaching_points") or []) < 3:
        report.add_critical("at least 3 key teaching points are required")
    if len(data.get("cognitive_traps") or []) < 2:
        report.add_critical("at least 2 cognitive traps are required")


def _check_safety_metadata(data: dict[str, Any], report: CaseQualityReport) -> None:
    if len(data.get("clinical_red_flags") or []) < 2:
        report.add_critical("at least 2 clinical red flags are required")
    if len(data.get("time_critical_actions") or []) < 2:
        report.add_critical("at least 2 time-critical actions are required")
    if len(data.get("contraindication_checks") or []) < 2:
        report.add_critical("at least 2 contraindication checks are required")


def _check_source_metadata(data: dict[str, Any], report: CaseQualityReport) -> None:
    sources = data.get("clinical_sources") or []
    if not sources:
        report.add_critical("at least 1 clinical source is required")
        return
    for index, source in enumerate(sources):
        if not isinstance(source, dict):
            report.add_critical(f"clinical_sources[{index}] must be an object")
            continue
        missing = [
            key
            for key in ("title", "organization", "url", "supports")
            if not source.get(key)
        ]
        if missing:
            report.add_critical(
                f"clinical_sources[{index}] missing {', '.join(missing)}"
            )
            continue
        _check_source_url(index, str(source["url"]), report)
        supports = source.get("supports")
        if (
            not isinstance(supports, list)
            or len([
                item
                for item in supports
                if isinstance(item, str) and item.strip()
            ]) < 2
        ):
            report.add_critical(
                f"clinical_sources[{index}] must list at least 2 supported case elements"
            )


def _check_source_url(index: int, url: str, report: CaseQualityReport) -> None:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not hostname:
        report.add_critical(f"clinical_sources[{index}].url must be a valid HTTPS URL")
        return
    if (
        hostname in PLACEHOLDER_SOURCE_HOSTS
        or hostname.endswith(".example")
        or any(hostname.endswith(f".{host}") for host in PLACEHOLDER_SOURCE_HOSTS)
    ):
        report.add_critical(
            f"clinical_sources[{index}].url must not use a placeholder source domain"
        )


def _check_review_metadata(data: dict[str, Any], report: CaseQualityReport) -> None:
    status = data.get("review_status")
    if status not in ALLOWED_REVIEW_STATUSES:
        report.add_critical("review_status is not recognized")
    if status == "clinician_reviewed" and not data.get("last_reviewed_at"):
        report.add_critical("clinician_reviewed cases require last_reviewed_at")
    if status == "educational_draft" and not data.get("last_reviewed_at"):
        report.add_warning("educational_draft cases should include last_reviewed_at")


def _check_coach_guidance(data: dict[str, Any], report: CaseQualityReport) -> None:
    guidance = str(data.get("coach_guidance", "")).lower()
    if "reveal" in guidance and "diagnosis" in guidance:
        report.add_critical("coach_guidance must not instruct revealing the diagnosis")
    if "tell the student" in guidance and "diagnosis" in guidance:
        report.add_critical("coach_guidance must not tell the student the diagnosis")
