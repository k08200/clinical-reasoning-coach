"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { api } from "@/lib/api";
import { reviewQualityGateStatuses, reviewQualityIssues } from "@/lib/caseQuality";
import { useRequireAuth } from "@/lib/useAuthGate";
import type {
  ClinicalCase,
  ClinicalCaseReview,
  ClinicalCaseReviewDetail,
  SourceAlignmentChecks,
  User,
} from "@/types";

type ReviewChecks = {
  clinical_accuracy_confirmed: boolean;
  source_alignment_confirmed: boolean;
  educational_safety_confirmed: boolean;
};

const DEFAULT_CHECKS: ReviewChecks = {
  clinical_accuracy_confirmed: false,
  source_alignment_confirmed: false,
  educational_safety_confirmed: false,
};

const DEFAULT_SOURCE_ALIGNMENT_CHECKS: SourceAlignmentChecks = {
  teaching_points_supported: false,
  red_flags_supported: false,
  time_critical_actions_supported: false,
  contraindication_checks_supported: false,
};

const MIN_REVIEW_NOTES_LENGTH = 30;
const MIN_REVIEWED_SOURCE_ORGANIZATIONS = 2;
const REVIEW_NOTE_SOURCE_TERMS = [
  "source",
  "sources",
  "cited",
  "citation",
  "evidence",
  "guideline",
  "guidelines",
];
const REVIEW_NOTE_SAFETY_TERMS = [
  "safety",
  "contraindication",
  "contraindications",
  "red flag",
  "red flags",
  "time-critical",
  "time critical",
];
const REVIEW_NOTE_EDUCATIONAL_TERMS = [
  "education",
  "educational",
  "simulation",
  "simulated",
  "limitation",
  "limitations",
  "not patient care",
];

const SOURCE_ALIGNMENT_ITEMS: Array<{
  key: keyof SourceAlignmentChecks;
  label: string;
  description: string;
}> = [
  {
    key: "teaching_points_supported",
    label: "Teaching points",
    description: "Each key teaching point is supported by at least one cited source.",
  },
  {
    key: "red_flags_supported",
    label: "Red flags",
    description: "Clinical red flags are consistent with the cited evidence.",
  },
  {
    key: "time_critical_actions_supported",
    label: "Time-critical actions",
    description: "Urgent actions and timing expectations align with cited guidance.",
  },
  {
    key: "contraindication_checks_supported",
    label: "Contraindication checks",
    description:
      "Safety checks before treatment are supported by cited sources from at least 2 independent organizations.",
  },
];

function isReviewer(user: User | undefined): boolean {
  return (
    user?.role === "clinician_reviewer" &&
    user.reviewer_verification_status === "verified"
  );
}

function statusClasses(requiresCaution: boolean): string {
  return requiresCaution
    ? "border-amber-700 bg-amber-950/30 text-amber-200"
    : "border-emerald-700 bg-emerald-950/30 text-emerald-200";
}

function formatAge(age: number | string): string {
  return typeof age === "number" ? `${age}yo` : age;
}

function formatGateFieldName(
  fieldName: "time_critical_actions" | "contraindication_checks" | "clinical_red_flags",
): string {
  if (fieldName === "time_critical_actions") {
    return "Time-critical actions";
  }
  if (fieldName === "clinical_red_flags") {
    return "Clinical red flags";
  }
  return "Contraindication checks";
}

function uniqueSourceOrganizations(organizations: string[]): string[] {
  const seen = new Set<string>();
  return organizations.reduce<string[]>((uniqueOrganizations, organization) => {
    const normalized = organization.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return uniqueOrganizations;
    }
    seen.add(normalized);
    uniqueOrganizations.push(organization.trim());
    return uniqueOrganizations;
  }, []);
}

function reviewNotesCoverAuditDomains(notes: string): boolean {
  const normalized = notes.trim().toLowerCase();
  if (normalized.length < MIN_REVIEW_NOTES_LENGTH) return false;
  return (
    REVIEW_NOTE_SOURCE_TERMS.some((term) => normalized.includes(term)) &&
    REVIEW_NOTE_SAFETY_TERMS.some((term) => normalized.includes(term)) &&
    REVIEW_NOTE_EDUCATIONAL_TERMS.some((term) => normalized.includes(term))
  );
}

function reviewApprovalDetail(
  detail: ClinicalCaseReviewDetail | undefined,
): ClinicalCaseReviewDetail | undefined {
  if (!detail) return undefined;
  return {
    ...detail,
    source_provenance: {
      ...detail.source_provenance,
      review_status: "clinician_reviewed",
    },
  };
}

export default function ReviewPage() {
  const checkingAuth = useRequireAuth();
  const [linkedCaseId, setLinkedCaseId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [checks, setChecks] = useState<ReviewChecks>(DEFAULT_CHECKS);
  const [sourceAlignmentChecks, setSourceAlignmentChecks] =
    useState<SourceAlignmentChecks>(DEFAULT_SOURCE_ALIGNMENT_CHECKS);
  const [practiceScope, setPracticeScope] = useState("");
  const [attestsReviewWithinScope, setAttestsReviewWithinScope] = useState(false);
  const [attestsEducationalUseOnly, setAttestsEducationalUseOnly] = useState(false);
  const [attestsSourcesAccessed, setAttestsSourcesAccessed] = useState(false);
  const [attestsSourcesCurrent, setAttestsSourcesCurrent] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const { data: user, error: userError } = useSWR<User>(
    checkingAuth ? null : "/api/auth/me",
    () => api.auth.me() as Promise<User>,
  );
  const reviewer = isReviewer(user);
  const canLoadReviewData = !!user && reviewer;

  const { data: cases, error: casesError, mutate: mutateCases } = useSWR<ClinicalCase[]>(
    canLoadReviewData ? "/api/cases?review=all" : null,
    () => api.cases.list() as Promise<ClinicalCase[]>,
  );
  const selectedCase = useMemo(
    () => cases?.find((clinicalCase) => clinicalCase.id === selectedCaseId) ?? cases?.[0],
    [cases, selectedCaseId],
  );
  const activeCaseId = selectedCase?.id ?? null;
  const { data: reviewDetail } = useSWR<ClinicalCaseReviewDetail>(
    activeCaseId && canLoadReviewData
      ? `/api/cases/${activeCaseId}/clinical-review/detail`
      : null,
    () => api.cases.clinicalReviewDetail(activeCaseId as string) as Promise<ClinicalCaseReviewDetail>,
  );
  const { data: history, mutate: mutateHistory } = useSWR<ClinicalCaseReview[]>(
    activeCaseId && canLoadReviewData
      ? `/api/cases/${activeCaseId}/clinical-review/history`
      : null,
    () => api.cases.clinicalReviewHistory(activeCaseId as string) as Promise<ClinicalCaseReview[]>,
  );

  const pendingCases = (cases ?? []).filter(
    (clinicalCase) => clinicalCase.source_provenance.requires_caution,
  );
  const allChecksConfirmed = Object.values(checks).every(Boolean);
  const allSourceAlignmentConfirmed = Object.values(sourceAlignmentChecks).every(Boolean);
  const reviewNotesReady = reviewNotesCoverAuditDomains(reviewNotes);
  const reviewerAttestationReady =
    practiceScope.trim().length >= 3 &&
    attestsReviewWithinScope &&
    attestsEducationalUseOnly;
  const sourceEvidenceAttestationReady =
    attestsSourcesAccessed && attestsSourcesCurrent && !!reviewDetail?.clinical_sources.length;
  const approvalDetail = useMemo(() => reviewApprovalDetail(reviewDetail), [reviewDetail]);
  const qualityIssues = useMemo(() => reviewQualityIssues(approvalDetail), [approvalDetail]);
  const qualityGateStatuses = useMemo(
    () => reviewQualityGateStatuses(reviewDetail),
    [reviewDetail],
  );
  const appliedQualityGateStatuses = qualityGateStatuses.filter((status) => status.applied);
  const missingQualityGateStatuses = appliedQualityGateStatuses.filter((status) => !status.passed);
  const independentOrganizations = useMemo(
    () =>
      uniqueSourceOrganizations(
        reviewDetail
          ? reviewDetail.clinical_sources.map((source) => source.organization)
          : (selectedCase?.source_provenance.organizations ?? []),
      ),
    [reviewDetail, selectedCase],
  );
  const sourceDiversityReady =
    independentOrganizations.length >= MIN_REVIEWED_SOURCE_ORGANIZATIONS;
  const approvalBlockerCount = qualityIssues.length;
  const canSubmitReview =
    allChecksConfirmed &&
    allSourceAlignmentConfirmed &&
    reviewNotesReady &&
    reviewerAttestationReady &&
    sourceEvidenceAttestationReady &&
    qualityIssues.length === 0;

  useEffect(() => {
    setLinkedCaseId(new URLSearchParams(window.location.search).get("case"));
  }, []);

  useEffect(() => {
    if (!linkedCaseId || !cases?.some((clinicalCase) => clinicalCase.id === linkedCaseId)) {
      return;
    }
    setSelectedCaseId(linkedCaseId);
  }, [cases, linkedCaseId]);

  async function handleSubmitReview() {
    if (!selectedCase) return;
    setSubmitting(true);
    setActionError("");
    setActionMessage("");
    try {
      await api.cases.completeClinicalReview(selectedCase.id, {
        ...checks,
        source_alignment_checks: sourceAlignmentChecks,
        reviewer_attestation: {
          practice_scope: practiceScope.trim(),
          attests_review_within_scope: attestsReviewWithinScope,
          attests_educational_use_only: attestsEducationalUseOnly,
        },
        source_evidence_attestation: {
          source_urls: reviewDetail?.clinical_sources.map((source) => source.url) ?? [],
          verified_on: new Date().toISOString().slice(0, 10),
          attests_sources_accessed: attestsSourcesAccessed,
          attests_sources_current: attestsSourcesCurrent,
        },
        review_notes: reviewNotes.trim() || undefined,
      });
      await mutateCases();
      await mutateHistory();
      setChecks(DEFAULT_CHECKS);
      setSourceAlignmentChecks(DEFAULT_SOURCE_ALIGNMENT_CHECKS);
      setPracticeScope("");
      setAttestsReviewWithinScope(false);
      setAttestsEducationalUseOnly(false);
      setAttestsSourcesAccessed(false);
      setAttestsSourcesCurrent(false);
      setReviewNotes("");
      setActionMessage("Clinical review recorded.");
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Could not record review");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingAuth || (!user && !userError)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (!user || userError || !reviewer) {
    return (
      <div className="min-h-screen bg-slate-900">
        <header className="border-b border-slate-700 px-6 py-4">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <Link href="/cases" className="text-sm text-slate-400 hover:text-white">
              Back to Cases
            </Link>
            <h1 className="text-lg font-semibold text-white">Clinical Review</h1>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <div className="rounded-lg border border-amber-700 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            Clinician reviewer role required.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="border-b border-slate-700 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Clinical Review</h1>
            <p className="text-xs text-slate-400">Reviewer queue and audit trail</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/cases" className="text-sm text-slate-400 hover:text-white">
              Cases
            </Link>
            <Link href="/analytics" className="text-sm text-slate-400 hover:text-white">
              Analytics
            </Link>
            <Link href="/safety" className="text-sm text-slate-400 hover:text-white">
              Safety Events
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Pending</p>
            <p className="mt-2 text-3xl font-bold text-white">{pendingCases.length}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total Cases</p>
            <p className="mt-2 text-3xl font-bold text-white">{cases?.length ?? 0}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Reviewer</p>
            <p className="mt-2 text-sm font-semibold text-white">{user.full_name}</p>
            <p className="text-sm text-slate-400">{user.role.replace(/_/g, " ")}</p>
          </div>
        </div>

        {(casesError || actionError) && (
          <div className="mb-6 rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
            {actionError || "Could not load review queue."}
          </div>
        )}
        {actionMessage && (
          <div className="mb-6 rounded-lg border border-emerald-700 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
            {actionMessage}
          </div>
        )}

        {!cases && !casesError ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        ) : cases?.length === 0 ? (
          <div className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-8 text-center text-slate-400">
            No cases available for review.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.3fr)]">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Review Queue
              </h2>
              {cases?.map((clinicalCase) => (
                <button
                  key={clinicalCase.id}
                  onClick={() => {
                    setSelectedCaseId(clinicalCase.id);
                    setChecks(DEFAULT_CHECKS);
                    setSourceAlignmentChecks(DEFAULT_SOURCE_ALIGNMENT_CHECKS);
                    setReviewNotes("");
                    setActionError("");
                    setActionMessage("");
                  }}
                  className={`w-full rounded-lg border p-4 text-left transition-colors ${
                    selectedCase?.id === clinicalCase.id
                      ? "border-brand-500 bg-slate-800"
                      : "border-slate-700 bg-slate-800/70 hover:border-slate-600"
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <p className="font-semibold text-white">{clinicalCase.title}</p>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${statusClasses(
                        clinicalCase.source_provenance.requires_caution,
                      )}`}
                    >
                      {clinicalCase.source_provenance.review_label}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400">
                    {clinicalCase.specialty.replace(/_/g, " ")} · {clinicalCase.difficulty} ·{" "}
                    {clinicalCase.source_provenance.source_count} source
                    {clinicalCase.source_provenance.source_count === 1 ? "" : "s"}
                  </p>
                </button>
              ))}
            </section>

            {selectedCase && (
              <section className="space-y-4">
                <div className="rounded-lg border border-slate-700 bg-slate-800 p-5">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-white">{selectedCase.title}</h2>
                      <p className="mt-1 text-sm text-slate-400">
                        {formatAge(selectedCase.patient_demographics.age)}{" "}
                        {selectedCase.patient_demographics.sex} · {selectedCase.chief_complaint}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${statusClasses(
                        selectedCase.source_provenance.requires_caution,
                      )}`}
                    >
                      {selectedCase.source_provenance.review_label}
                    </span>
                  </div>

                  {reviewDetail && (
                    <div
                      className={`mb-4 rounded-lg border p-3 ${
                        approvalBlockerCount > 0
                          ? "border-amber-700 bg-amber-950/30"
                          : "border-emerald-700 bg-emerald-950/20"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p
                          className={`text-xs font-semibold uppercase tracking-wide ${
                            approvalBlockerCount > 0 ? "text-amber-300" : "text-emerald-300"
                          }`}
                        >
                          Approval Blockers
                        </p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            approvalBlockerCount > 0
                              ? "border-amber-700 bg-amber-950/40 text-amber-100"
                              : "border-emerald-700 bg-emerald-950/40 text-emerald-100"
                          }`}
                        >
                          {approvalBlockerCount}
                        </span>
                      </div>
                      {approvalBlockerCount > 0 ? (
                        <ul className="mt-2 space-y-1 text-sm text-amber-100">
                          {qualityIssues.slice(0, 3).map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-emerald-100">
                          Quality gate clear for clinician review once checklist confirmations
                          and review notes are complete.
                        </p>
                      )}
                      {approvalBlockerCount > 3 && (
                        <p className="mt-2 text-xs text-amber-200">
                          {approvalBlockerCount - 3} more blocker
                          {approvalBlockerCount - 3 === 1 ? "" : "s"} listed below.
                        </p>
                      )}
                    </div>
                  )}

                  {reviewDetail ? (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Teaching Points</p>
                          <ul className="mt-2 space-y-2 text-sm text-slate-300">
                            {reviewDetail.key_teaching_points.map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Cognitive Traps</p>
                          <ul className="mt-2 space-y-2 text-sm text-slate-300">
                            {reviewDetail.cognitive_traps.map((trap) => (
                              <li key={trap}>{trap}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="rounded-lg border border-emerald-700 bg-emerald-950/20 p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-emerald-400">
                            Diagnosis
                          </p>
                          <p className="mt-2 text-sm font-semibold text-emerald-100">
                            {reviewDetail.diagnosis}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Coach Guidance
                          </p>
                          <p className="mt-2 text-sm text-slate-300">
                            {reviewDetail.coach_guidance}
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-sm text-slate-400">
                      Loading reviewer-only case detail...
                    </div>
                  )}

                  {reviewDetail && (
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <div className="rounded-lg border border-red-800 bg-red-950/20 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-red-300">
                          Red Flags
                        </p>
                        <ul className="mt-2 space-y-2 text-sm text-red-100">
                          {reviewDetail.clinical_red_flags.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-lg border border-amber-800 bg-amber-950/20 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-amber-300">
                          Time-Critical Actions
                        </p>
                        <ul className="mt-2 space-y-2 text-sm text-amber-100">
                          {reviewDetail.time_critical_actions.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-lg border border-sky-800 bg-sky-950/20 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-sky-300">
                          Contraindication Checks
                        </p>
                        <ul className="mt-2 space-y-2 text-sm text-sky-100">
                          {reviewDetail.contraindication_checks.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {qualityIssues.length > 0 && (
                    <div className="mt-4 rounded-lg border border-amber-700 bg-amber-950/30 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                        Quality Gate
                      </p>
                      <ul className="mt-2 space-y-1 text-sm text-amber-100">
                        {qualityIssues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {reviewDetail && (
                    <div className="mt-4 border-t border-slate-700 pt-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Safety Gate Checklist
                          </p>
                          <p className="mt-1 text-sm text-slate-400">
                            {appliedQualityGateStatuses.length === 0
                              ? "No domain-specific treatment safety gate was triggered by this case."
                              : `${appliedQualityGateStatuses.length} domain-specific gate${
                                  appliedQualityGateStatuses.length === 1 ? "" : "s"
                                } triggered for clinician review.`}
                          </p>
                        </div>
                        {appliedQualityGateStatuses.length > 0 && (
                          <span
                            className={`w-fit rounded-full border px-2.5 py-1 text-xs font-medium ${
                              missingQualityGateStatuses.length > 0
                                ? "border-amber-700 bg-amber-950/30 text-amber-200"
                                : "border-emerald-700 bg-emerald-950/30 text-emerald-200"
                            }`}
                          >
                            {missingQualityGateStatuses.length > 0
                              ? `${missingQualityGateStatuses.length} missing`
                              : "All clear"}
                          </span>
                        )}
                      </div>
                      <div className="mt-3 space-y-2">
                        {(appliedQualityGateStatuses.length > 0
                          ? appliedQualityGateStatuses
                          : qualityGateStatuses
                        ).map((status) => (
                          <div
                            key={status.name}
                            className={`border-l-2 py-2 pl-3 ${
                              !status.applied
                                ? "border-slate-700"
                                : status.passed
                                  ? "border-emerald-600"
                                  : "border-amber-500"
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`text-xs font-semibold uppercase ${
                                  !status.applied
                                    ? "text-slate-500"
                                    : status.passed
                                      ? "text-emerald-300"
                                      : "text-amber-300"
                                }`}
                              >
                                {!status.applied ? "Not triggered" : status.passed ? "Clear" : "Missing"}
                              </span>
                              <span className="text-sm font-medium text-slate-100">
                                {status.label}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-400">
                              {formatGateFieldName(status.fieldName)}
                            </p>
                            {status.applied && !status.passed && (
                              <p className="mt-1 text-sm text-amber-100">{status.issue}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Source Provenance
                    </p>
                    <p className="mt-2 text-sm text-slate-300">
                      {selectedCase.source_provenance.source_count} clinical source
                      {selectedCase.source_provenance.source_count === 1 ? "" : "s"}
                    </p>
                    {selectedCase.source_provenance.organizations.length > 0 && (
                      <p className="mt-1 text-sm text-slate-400">
                        {selectedCase.source_provenance.organizations.join(", ")}
                      </p>
                    )}
                    <div className="mt-3 rounded border border-slate-700 bg-slate-950/50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-100">
                          Independent source organizations
                        </p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            sourceDiversityReady
                              ? "border-emerald-700 bg-emerald-950/30 text-emerald-200"
                              : "border-amber-700 bg-amber-950/30 text-amber-200"
                          }`}
                        >
                          {independentOrganizations.length}/{MIN_REVIEWED_SOURCE_ORGANIZATIONS}
                        </span>
                      </div>
                      {!sourceDiversityReady && (
                        <p className="mt-2 text-sm text-amber-100">
                          Approval requires at least 2 independent clinical source
                          organizations.
                        </p>
                      )}
                    </div>
                    {reviewDetail && (
                      <div className="mt-3 space-y-3">
                        {reviewDetail.clinical_sources.map((source) => (
                          <div
                            key={`${source.organization}-${source.title}`}
                            className="rounded border border-slate-700 bg-slate-950/50 p-3"
                          >
                            <p className="text-sm font-semibold text-white">{source.title}</p>
                            <p className="text-xs text-slate-400">{source.organization}</p>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block break-all text-xs text-sky-300 hover:text-sky-200"
                            >
                              {source.url}
                            </a>
                            {source.supports.length > 0 && (
                              <p className="mt-2 text-xs text-slate-300">
                                Supports: {source.supports.join(", ")}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-700 bg-slate-800 p-5">
                  <h3 className="mb-4 font-semibold text-white">Review Checklist</h3>
                  <div className="mb-4 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Source Alignment Evidence
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      Confirm that cited sources support each reviewed content area before marking
                      source alignment complete.
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {SOURCE_ALIGNMENT_ITEMS.map((item) => (
                        <label
                          key={item.key}
                          className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-300"
                        >
                          <input
                            type="checkbox"
                            checked={sourceAlignmentChecks[item.key]}
                            onChange={(event) =>
                              setSourceAlignmentChecks((current) => ({
                                ...current,
                                [item.key]: event.target.checked,
                              }))
                            }
                            className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800"
                          />
                          <span>
                            <span className="block font-medium text-slate-100">{item.label}</span>
                            <span className="mt-0.5 block text-xs text-slate-400">
                              {item.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {[
                      ["clinical_accuracy_confirmed", "Diagnosis, findings, and teaching points are clinically accurate."],
                      [
                        "source_alignment_confirmed",
                        "Cited sources support all checked educational and safety content areas.",
                      ],
                      ["educational_safety_confirmed", "Case is appropriate for simulation, not patient care."],
                    ].map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-sm text-slate-300"
                      >
                        <input
                          type="checkbox"
                          checked={checks[key as keyof ReviewChecks]}
                          onChange={(event) =>
                            setChecks((current) => ({
                              ...current,
                              [key]: event.target.checked,
                            }))
                          }
                          className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <label className="mt-4 block text-sm font-medium text-slate-300">
                    Clinical practice scope
                    <input
                      aria-label="Clinical practice scope"
                      value={practiceScope}
                      onChange={(event) => setPracticeScope(event.target.value)}
                      maxLength={200}
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                    />
                  </label>
                  <div className="mt-3 space-y-3">
                    <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-sm text-slate-300">
                      <input
                        aria-label="I opened every cited source listed for this case."
                        type="checkbox"
                        checked={attestsSourcesAccessed}
                        onChange={(event) => setAttestsSourcesAccessed(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800"
                      />
                      <span>I opened every cited source listed for this case.</span>
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-sm text-slate-300">
                      <input
                        aria-label="I confirm the cited sources remain current for this educational case."
                        type="checkbox"
                        checked={attestsSourcesCurrent}
                        onChange={(event) => setAttestsSourcesCurrent(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800"
                      />
                      <span>I confirm the cited sources remain current for this educational case.</span>
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-sm text-slate-300">
                      <input
                        aria-label="I attest this review is within my clinical practice scope."
                        type="checkbox"
                        checked={attestsReviewWithinScope}
                        onChange={(event) => setAttestsReviewWithinScope(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800"
                      />
                      <span>I attest this review is within my clinical practice scope.</span>
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-sm text-slate-300">
                      <input
                        aria-label="I attest this approval is for educational simulation only."
                        type="checkbox"
                        checked={attestsEducationalUseOnly}
                        onChange={(event) => setAttestsEducationalUseOnly(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800"
                      />
                      <span>I attest this approval is for educational simulation only.</span>
                    </label>
                  </div>
                  <label className="mt-4 block text-sm font-medium text-slate-300">
                    Review Notes
                    <textarea
                      aria-label="Review Notes"
                      value={reviewNotes}
                      onChange={(event) => setReviewNotes(event.target.value)}
                      maxLength={2000}
                      rows={4}
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                    />
                    <span className="mt-1 block text-xs text-slate-400">
                      Summarize source alignment, safety checks, and educational limitations
                      before approving.
                    </span>
                    {!reviewNotesReady && (
                      <span className="mt-1 block text-xs text-amber-300">
                        Add at least {MIN_REVIEW_NOTES_LENGTH} characters and mention source
                        alignment, safety checks, and educational limitations.
                      </span>
                    )}
                  </label>
                  <button
                    onClick={handleSubmitReview}
                    disabled={!canSubmitReview || submitting}
                    className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? "Recording..." : "Mark Clinician Reviewed"}
                  </button>
                </div>

                <div className="rounded-lg border border-slate-700 bg-slate-800 p-5">
                  <h3 className="mb-4 font-semibold text-white">Review History</h3>
                  {!history ? (
                    <p className="text-sm text-slate-400">Loading history...</p>
                  ) : history.length === 0 ? (
                    <p className="text-sm text-slate-400">No clinical review history yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {history.map((review) => (
                        <div
                          key={review.id}
                          className="rounded-lg border border-slate-700 bg-slate-900/40 p-3"
                        >
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-white">
                              {review.prior_review_status.replace(/_/g, " ")} to{" "}
                              {review.resulting_review_status.replace(/_/g, " ")}
                            </span>
                            <span className="text-xs text-slate-500">
                              {new Date(review.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          {review.review_notes && (
                            <p className="mt-2 text-sm text-slate-300">{review.review_notes}</p>
                          )}
                          <p className="mt-2 text-xs text-slate-500">
                            {review.source_snapshot.source_count} source
                            {review.source_snapshot.source_count === 1 ? "" : "s"} checked
                          </p>
                          {review.source_snapshot.reviewer_attestation && (
                            <p className="mt-2 text-xs text-slate-400">
                              Scope: {review.source_snapshot.reviewer_attestation.practice_scope}
                            </p>
                          )}
                          {review.source_snapshot.source_evidence_attestation && (
                            <p className="mt-2 text-xs text-slate-400">
                              Sources opened and current as of {review.source_snapshot.source_evidence_attestation.verified_on}.
                            </p>
                          )}
                          {review.source_snapshot.alignment_checklist && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {SOURCE_ALIGNMENT_ITEMS.filter(
                                (item) => review.source_snapshot.alignment_checklist?.[item.key],
                              ).map((item) => (
                                <span
                                  key={item.key}
                                  className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300"
                                >
                                  {item.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
