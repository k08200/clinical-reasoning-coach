"use client";

import Link from "next/link";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/useAuthGate";
import type { GovernanceReadiness, User } from "@/types";

function countTone(value: number, warning = false): string {
  if (value === 0) return "text-emerald-300";
  return warning ? "text-red-300" : "text-amber-300";
}

export default function GovernanceReadinessPage() {
  const checkingAuth = useRequireAuth();
  const { data: user, error: userError } = useSWR<User>(
    checkingAuth ? null : "/api/auth/me",
    () => api.auth.me() as Promise<User>,
  );
  const isAdmin = user?.role === "admin";
  const { data: readiness, error: readinessError } = useSWR<GovernanceReadiness>(
    isAdmin ? "/api/governance/readiness" : null,
    () => api.governance.readiness(),
  );

  if (checkingAuth || (!user && !userError)) {
    return <div className="min-h-screen bg-slate-900" />;
  }

  if (!user || userError || !isAdmin) {
    return (
      <main className="min-h-screen bg-slate-900 px-6 py-10 text-sm text-amber-100">
        Admin role required.
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-700 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Governance Readiness</h1>
            <p className="text-xs text-slate-400">Learner release control status</p>
          </div>
          <nav className="flex items-center gap-4 text-sm text-slate-400">
            <Link href="/admin/users" className="hover:text-white">Users</Link>
            <Link href="/review" className="hover:text-white">Clinical Review</Link>
            <Link href="/safety" className="hover:text-white">Safety Events</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {readinessError && (
          <p className="border border-red-700 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            Could not load governance readiness.
          </p>
        )}
        {!readiness && !readinessError ? (
          <div className="py-16 text-center text-sm text-slate-400">Loading readiness...</div>
        ) : readiness && (
          <>
            <section
              className={`border px-5 py-4 ${
                readiness.release_ready
                  ? "border-emerald-700 bg-emerald-950/20"
                  : "border-red-700 bg-red-950/20"
              }`}
            >
              <p className="text-sm font-semibold">
                {readiness.release_ready ? "Learner release ready" : "Learner release blocked"}
              </p>
              {readiness.release_blockers.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-slate-300">
                  {readiness.release_blockers.map((blocker) => (
                    <li key={blocker.code}>{blocker.message}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="border border-slate-700 bg-slate-800 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Eligible Cases</p>
                <p className="mt-2 text-3xl font-bold text-emerald-300">
                  {readiness.learner_eligible_case_count}
                </p>
              </div>
              <div className="border border-slate-700 bg-slate-800 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Blocked Cases</p>
                <p className={`mt-2 text-3xl font-bold ${countTone(readiness.case_blocker_count)}`}>
                  {readiness.case_blocker_count}
                </p>
              </div>
              <div className="border border-slate-700 bg-slate-800 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Open High-Risk Events</p>
                <p className={`mt-2 text-3xl font-bold ${countTone(readiness.open_high_risk_safety_event_count, true)}`}>
                  {readiness.open_high_risk_safety_event_count}
                </p>
              </div>
              <div className="border border-slate-700 bg-slate-800 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Consent Renewal</p>
                <p className={`mt-2 text-3xl font-bold ${countTone(readiness.consent_renewal_required_user_count)}`}>
                  {readiness.consent_renewal_required_user_count}
                </p>
              </div>
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-2">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Case Review Queue</h2>
                <div className="mt-3 divide-y divide-slate-700 border border-slate-700 bg-slate-800">
                  {readiness.case_blockers.length === 0 ? (
                    <p className="px-4 py-5 text-sm text-emerald-200">No blocked cases.</p>
                  ) : (
                    readiness.case_blockers.map((caseBlocker) => (
                      <div key={caseBlocker.case_id} className="px-4 py-3">
                        <Link href={`/review?case=${caseBlocker.case_id}`} className="text-sm font-semibold text-white hover:text-sky-300">
                          {caseBlocker.title}
                        </Link>
                        <p className="mt-1 text-xs text-amber-200">{caseBlocker.reasons.join(" · ")}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Operational Controls</h2>
                <dl className="mt-3 divide-y divide-slate-700 border border-slate-700 bg-slate-800 text-sm">
                  <div className="flex justify-between px-4 py-3"><dt>All open safety events</dt><dd>{readiness.open_safety_event_count}</dd></div>
                  <div className="flex justify-between px-4 py-3"><dt>Verified clinician reviewers</dt><dd className="text-emerald-300">{readiness.verified_clinician_reviewer_count}</dd></div>
                  <div className="flex justify-between px-4 py-3"><dt>Expired reviewer credentials</dt><dd className={countTone(readiness.expired_clinician_reviewer_count)}>{readiness.expired_clinician_reviewer_count}</dd></div>
                  <div className="flex justify-between px-4 py-3"><dt>Pending reviewer verification</dt><dd className={countTone(readiness.pending_clinician_reviewer_count)}>{readiness.pending_clinician_reviewer_count}</dd></div>
                  <div className="flex justify-between px-4 py-3"><dt>Suspended reviewers</dt><dd className={countTone(readiness.suspended_clinician_reviewer_count)}>{readiness.suspended_clinician_reviewer_count}</dd></div>
                </dl>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
