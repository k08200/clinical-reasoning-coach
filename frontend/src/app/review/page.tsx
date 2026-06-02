"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/useAuthGate";
import type {
  ClinicalCase,
  ClinicalCaseReview,
  ClinicalCaseReviewDetail,
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

function isReviewer(user: User | undefined): boolean {
  return user?.role === "clinician_reviewer" || user?.role === "admin";
}

function statusClasses(requiresCaution: boolean): string {
  return requiresCaution
    ? "border-amber-700 bg-amber-950/30 text-amber-200"
    : "border-emerald-700 bg-emerald-950/30 text-emerald-200";
}

export default function ReviewPage() {
  const checkingAuth = useRequireAuth();
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [checks, setChecks] = useState<ReviewChecks>(DEFAULT_CHECKS);
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

  async function handleSubmitReview() {
    if (!selectedCase) return;
    setSubmitting(true);
    setActionError("");
    setActionMessage("");
    try {
      await api.cases.completeClinicalReview(selectedCase.id, {
        ...checks,
        review_notes: reviewNotes.trim() || undefined,
      });
      await mutateCases();
      await mutateHistory();
      setChecks(DEFAULT_CHECKS);
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
                        {selectedCase.patient_demographics.age}yo{" "}
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

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Teaching Points</p>
                      <ul className="mt-2 space-y-2 text-sm text-slate-300">
                        {selectedCase.key_teaching_points.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Cognitive Traps</p>
                      <ul className="mt-2 space-y-2 text-sm text-slate-300">
                        {selectedCase.cognitive_traps.map((trap) => (
                          <li key={trap}>{trap}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {reviewDetail ? (
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
                  <div className="space-y-3">
                    {[
                      ["clinical_accuracy_confirmed", "Diagnosis, findings, and teaching points are clinically accurate."],
                      ["source_alignment_confirmed", "Cited sources support the educational content."],
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
                    Review Notes
                    <textarea
                      value={reviewNotes}
                      onChange={(event) => setReviewNotes(event.target.value)}
                      maxLength={2000}
                      rows={4}
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                    />
                  </label>
                  <button
                    onClick={handleSubmitReview}
                    disabled={!allChecksConfirmed || submitting}
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
