"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/useAuthGate";
import type {
  ModelReleaseClinicalReviewTarget,
  User,
} from "@/types";

const CONFIRMATIONS = [
  {
    key: "output_safety_confirmed",
    label: "Output safety",
    description: "I reviewed safety behavior for the evaluated model release.",
  },
  {
    key: "socratic_integrity_confirmed",
    label: "Socratic integrity",
    description: "I confirmed the coach preserves guided clinical reasoning rather than prescribing care.",
  },
  {
    key: "latency_confirmed",
    label: "Operational latency",
    description: "I reviewed the recorded response-time behavior for the evaluated release.",
  },
  {
    key: "educational_use_only_confirmed",
    label: "Educational limitation",
    description: "I confirmed the release is limited to supervised educational simulation, not patient care.",
  },
] as const;

type ConfirmationKey = (typeof CONFIRMATIONS)[number]["key"];
type Confirmations = Record<ConfirmationKey, boolean>;

const DEFAULT_CONFIRMATIONS: Confirmations = {
  output_safety_confirmed: false,
  socratic_integrity_confirmed: false,
  latency_confirmed: false,
  educational_use_only_confirmed: false,
};

function isReviewer(user: User | undefined): boolean {
  return (
    user?.role === "clinician_reviewer" &&
    user.reviewer_verification_status === "verified" &&
    user.reviewer_credential_current !== false
  );
}

export default function ModelReleaseReviewPage() {
  const checkingAuth = useRequireAuth();
  const [practiceScope, setPracticeScope] = useState("");
  const [confirmations, setConfirmations] = useState<Confirmations>(DEFAULT_CONFIRMATIONS);
  const [reviewNotes, setReviewNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const { data: user, error: userError } = useSWR<User>(
    checkingAuth ? null : "/api/auth/me",
    () => api.auth.me() as Promise<User>,
  );
  const reviewer = isReviewer(user);
  const { data: target, error: targetError, mutate: mutateTarget } =
    useSWR<ModelReleaseClinicalReviewTarget>(
      reviewer ? "/api/governance/model-release-review-target" : null,
      () => api.governance.modelReleaseReviewTarget(),
    );

  useEffect(() => {
    if (user?.reviewer_practice_scope) {
      setPracticeScope(user.reviewer_practice_scope);
    }
  }, [user?.id, user?.reviewer_practice_scope]);

  const allConfirmed = Object.values(confirmations).every(Boolean);
  const canSubmit =
    !!target &&
    target.evaluation_current &&
    !target.current_reviewer_has_approved &&
    practiceScope.trim().length >= 3 &&
    reviewNotes.trim().length >= 30 &&
    allConfirmed;

  async function submitReview() {
    if (!canSubmit) return;
    setSubmitting(true);
    setActionError("");
    setActionMessage("");
    try {
      await api.governance.recordModelReleaseReview({
        practice_scope: practiceScope.trim(),
        ...confirmations,
        review_notes: reviewNotes.trim(),
      });
      await mutateTarget();
      setActionMessage("Model release clinical review recorded.");
    } catch (error) {
      console.error(error);
      setActionError(error instanceof Error ? error.message : "Could not record review.");
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
      <main className="min-h-screen bg-slate-900 px-6 py-10 text-sm text-amber-100">
        Clinician reviewer role with a current credential is required.
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-700 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Model Release Review</h1>
            <p className="text-xs text-slate-400">Independent clinical approval record</p>
          </div>
          <nav className="flex items-center gap-4 text-sm text-slate-400">
            <Link href="/review" className="hover:text-white">Clinical Review</Link>
            <Link href="/cases" className="hover:text-white">Cases</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {(targetError || actionError) && (
          <p className="border border-red-700 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            {actionError || "Could not load the model release review target."}
          </p>
        )}
        {actionMessage && (
          <p className="mt-4 border border-emerald-700 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
            {actionMessage}
          </p>
        )}
        {!target && !targetError ? (
          <div className="py-16 text-center text-sm text-slate-400">Loading release target...</div>
        ) : target && (
          <>
            <section className="border border-slate-700 bg-slate-800 p-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Provider</dt>
                  <dd className="mt-1 font-medium text-white">{target.provider}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Model</dt>
                  <dd className="mt-1 font-medium text-white">{target.model}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Evaluation hash</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-slate-300">{target.evaluation_sha256}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Independent approvals</dt>
                  <dd className="mt-1 font-medium text-white">
                    {target.current_reviewer_count}/{target.required_reviewer_count}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Evaluation status</dt>
                  <dd className={`mt-1 font-medium ${target.evaluation_current ? "text-emerald-300" : "text-red-300"}`}>
                    {target.evaluation_current ? "Current" : "Not current"}
                  </dd>
                </div>
              </dl>
              {!target.evaluation_current && (
                <p className="mt-4 text-sm text-red-200">{target.evaluation_detail}</p>
              )}
            </section>

            {target.current_reviewer_has_approved ? (
              <section className="mt-6 border border-emerald-700 bg-emerald-950/20 px-5 py-4 text-sm text-emerald-100">
                Your approval for this evaluated model release is already recorded.
              </section>
            ) : (
              <section className="mt-6">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  Clinical attestation
                </h2>
                <div className="mt-3 space-y-5 border border-slate-700 bg-slate-800 p-5">
                  <label className="block text-sm text-slate-200">
                    Practice scope
                    <input
                      value={practiceScope}
                      onChange={(event) => setPracticeScope(event.target.value)}
                      className="mt-2 w-full border border-slate-600 bg-slate-900 px-3 py-2 text-white outline-none focus:border-brand-500"
                      placeholder="Clinical practice scope"
                    />
                  </label>
                  <div className="space-y-3">
                    {CONFIRMATIONS.map((confirmation) => (
                      <label key={confirmation.key} className="flex cursor-pointer gap-3 border border-slate-700 bg-slate-900/60 p-3">
                        <input
                          type="checkbox"
                          aria-label={confirmation.label}
                          checked={confirmations[confirmation.key]}
                          onChange={(event) =>
                            setConfirmations((current) => ({
                              ...current,
                              [confirmation.key]: event.target.checked,
                            }))
                          }
                          className="mt-0.5 h-4 w-4 shrink-0 accent-sky-500"
                        />
                        <span>
                          <span className="block text-sm font-medium text-white">{confirmation.label}</span>
                          <span className="mt-0.5 block text-xs text-slate-400">{confirmation.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <label className="block text-sm text-slate-200">
                    Review notes
                    <textarea
                      value={reviewNotes}
                      onChange={(event) => setReviewNotes(event.target.value)}
                      rows={5}
                      className="mt-2 w-full resize-y border border-slate-600 bg-slate-900 px-3 py-2 text-white outline-none focus:border-brand-500"
                      placeholder="Document the evidence reviewed, material safety findings, and educational limitations."
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void submitReview()}
                    disabled={!canSubmit || submitting}
                    className="border border-brand-500 bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:border-slate-600 disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    {submitting ? "Recording..." : "Record clinical approval"}
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
