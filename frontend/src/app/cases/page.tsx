"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/api";
import { logout } from "@/lib/auth";
import { useRequireAuth } from "@/lib/useAuthGate";
import type { ClinicalCase, User } from "@/types";

const SPECIALTIES = [
  "All",
  "internal_medicine",
  "surgery",
  "emergency_medicine",
  "psychiatry",
  "pediatrics",
  "neurology",
  "cardiology",
];

const DIFFICULTY_COLORS = {
  easy: "text-green-400 bg-green-900/30",
  medium: "text-yellow-400 bg-yellow-900/30",
  hard: "text-red-400 bg-red-900/30",
};

function formatAge(age: number | string): string {
  return typeof age === "number" ? `${age}yo` : age;
}

export default function CasesPage() {
  const router = useRouter();
  const checkingAuth = useRequireAuth();
  const [specialty, setSpecialty] = useState("All");
  const [generating, setGenerating] = useState(false);
  const [startingSession, setStartingSession] = useState<string | null>(null);
  const [acknowledgingCase, setAcknowledgingCase] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: cases, error: casesError, mutate } = useSWR<ClinicalCase[]>(
    checkingAuth ? null : `/api/cases?${specialty !== "All" ? `specialty=${specialty}` : ""}`,
    () =>
      api.cases.list(specialty !== "All" ? { specialty } : undefined) as Promise<ClinicalCase[]>,
  );
  const { data: currentUser } = useSWR<User>(
    checkingAuth ? null : "/api/auth/me",
    () => api.auth.me() as Promise<User>,
  );
  const caseList = cases ?? [];
  const canReview =
    currentUser?.role === "clinician_reviewer" || currentUser?.role === "admin";
  const requiresReReview = (clinicalCase: ClinicalCase): boolean =>
    clinicalCase.source_provenance.review_stale ||
    clinicalCase.source_provenance.review_content_changed;

  async function handleGenerateDemo() {
    setGenerating(true);
    setActionError("");
    try {
      await api.cases.generateDemo();
      await mutate();
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Could not generate a case");
    } finally {
      setGenerating(false);
    }
  }

  async function handleStartSession(clinicalCase: ClinicalCase, acknowledged = false) {
    if (requiresReReview(clinicalCase)) {
      setAcknowledgingCase(null);
      setActionError("This case requires clinician re-review before sessions can start.");
      return;
    }
    if (clinicalCase.source_provenance.requires_caution && !acknowledged) {
      setAcknowledgingCase(clinicalCase.id);
      setActionError("");
      return;
    }

    setStartingSession(clinicalCase.id);
    setActionError("");
    try {
      const session = await api.sessions.create(clinicalCase.id, {
        acknowledge_unreviewed_case: clinicalCase.source_provenance.requires_caution,
      }) as { id: string };
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Could not start the session");
      setStartingSession(null);
    }
  }

  function cautionText(clinicalCase: ClinicalCase): string {
    if (clinicalCase.source_provenance.review_content_changed) {
      return "Case changed after clinician review; re-review required.";
    }
    if (clinicalCase.source_provenance.review_stale) {
      return "Clinician review is stale; re-review required.";
    }
    return "Not clinician reviewed; use only for education.";
  }

  function acknowledgementText(clinicalCase: ClinicalCase): string {
    if (clinicalCase.source_provenance.review_content_changed) {
      return "This case changed after clinician review. Start only as educational simulation.";
    }
    if (clinicalCase.source_provenance.review_stale) {
      return "This case has a stale clinician review. Start only as educational simulation.";
    }
    return "This case is not clinician reviewed. Start only as educational simulation.";
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Clinical Reasoning Coach</h1>
            <p className="text-xs text-slate-400">Socratic diagnostic training</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/sessions/history" className="text-sm text-slate-400 hover:text-white">
              My Sessions
            </Link>
            <Link href="/analytics" className="text-sm text-slate-400 hover:text-white">
              Analytics
            </Link>
            {canReview && (
              <>
                <Link href="/review" className="text-sm text-slate-400 hover:text-white">
                  Clinical Review
                </Link>
                <Link href="/safety" className="text-sm text-slate-400 hover:text-white">
                  Safety Events
                </Link>
              </>
            )}
            {currentUser?.role === "admin" && (
              <Link href="/admin/users" className="text-sm text-slate-400 hover:text-white">
                User Admin
              </Link>
            )}
            <button
              onClick={logout}
              className="text-sm text-slate-400 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Actions */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">Clinical Cases</h2>
            <p className="text-slate-400 mt-1">
              Each case trains your diagnostic reasoning through Socratic questioning
            </p>
          </div>
          <button
            onClick={handleGenerateDemo}
            disabled={generating}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {generating ? "Generating..." : "+ Generate Demo Case"}
          </button>
        </div>

        {/* Specialty filter */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {SPECIALTIES.map((s) => (
            <button
              key={s}
              onClick={() => setSpecialty(s)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                specialty === s
                  ? "bg-brand-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {s.replace(/_/g, " ")}
            </button>
          ))}
        </div>

        {(actionError || casesError) && (
          <div className="mb-6 rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
            {actionError || "Could not load cases. Please try again."}
          </div>
        )}

        {/* Cases grid */}
        {checkingAuth || (!cases && !casesError) ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
          </div>
        ) : casesError ? (
          <div className="text-center py-16">
            <p className="text-slate-400 text-lg mb-4">Cases could not be loaded</p>
            <button
              onClick={() => mutate()}
              className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-medium"
            >
              Try Again
            </button>
          </div>
        ) : caseList.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-400 text-lg mb-4">No cases yet</p>
            <button
              onClick={handleGenerateDemo}
              className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-medium"
            >
              Generate Your First Case
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {caseList.map((c) => {
              const reReviewRequired = requiresReReview(c);
              return (
                <div
                  key={c.id}
                  className="bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-slate-600 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-xs text-brand-400 font-medium uppercase tracking-wide">
                      {c.specialty.replace(/_/g, " ")}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        DIFFICULTY_COLORS[c.difficulty]
                      }`}
                    >
                      {c.difficulty}
                    </span>
                  </div>

                  <h3 className="text-white font-semibold mb-2 line-clamp-2">{c.title}</h3>

                  <p className="text-slate-400 text-sm mb-1">
                    <strong className="text-slate-300">CC:</strong> {c.chief_complaint}
                  </p>
                  <p className="text-slate-400 text-sm mb-4">
                    {formatAge(c.patient_demographics.age)} {c.patient_demographics.sex}
                  </p>

                  <div className="mb-4 rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-slate-300">
                        {c.source_provenance.source_count} clinical source
                        {c.source_provenance.source_count === 1 ? "" : "s"}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${
                          c.source_provenance.requires_caution
                            ? "bg-amber-950/50 text-amber-300"
                            : "bg-emerald-950/50 text-emerald-300"
                        }`}
                      >
                        {c.source_provenance.review_label}
                      </span>
                    </div>
                    {c.source_provenance.requires_caution && (
                      <p className="mt-2 text-xs font-medium text-amber-300">
                        {cautionText(c)}
                      </p>
                    )}
                    {c.source_provenance.organizations.length > 0 && (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                        {c.source_provenance.organizations.join(", ")}
                      </p>
                    )}
                    {c.source_provenance.last_reviewed_at && (
                      <p className="mt-1 text-xs text-slate-500">
                        Reviewed {c.source_provenance.last_reviewed_at}
                        {c.source_provenance.review_valid_until
                          ? ` · Valid until ${c.source_provenance.review_valid_until}`
                          : ""}
                      </p>
                    )}
                  </div>

                  {acknowledgingCase === c.id && !reReviewRequired && (
                    <div className="mb-4 border-l-2 border-amber-500 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
                      {acknowledgementText(c)}
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handleStartSession(c, true)}
                          disabled={startingSession === c.id}
                          className="rounded bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          Acknowledge and Start
                        </button>
                        <button
                          onClick={() => setAcknowledgingCase(null)}
                          className="rounded border border-amber-700 px-3 py-1 font-semibold text-amber-100 hover:bg-amber-950/50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{c.times_used} sessions</span>
                    <button
                      onClick={() => handleStartSession(c)}
                      disabled={startingSession === c.id || reReviewRequired}
                      className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
                    >
                      {reReviewRequired
                        ? "Re-review Required"
                        : startingSession === c.id
                          ? "Starting..."
                          : "Start Session"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
