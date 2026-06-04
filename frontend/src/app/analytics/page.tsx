"use client";

import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/useAuthGate";
import type { UserAnalytics } from "@/types";

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const width = Math.max(4, Math.min(100, value));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
        <span className="capitalize text-slate-300">{formatLabel(label)}</span>
        <span className="font-semibold text-white">{value.toFixed(0)}/100</span>
      </div>
      <div className="h-2 rounded-full bg-slate-700">
        <div
          className="h-2 rounded-full bg-brand-500"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function SafetyMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "amber" | "red";
}) {
  const toneClasses = {
    slate: "border-slate-700 bg-slate-900/50 text-slate-200",
    amber: "border-amber-700 bg-amber-950/30 text-amber-100",
    red: "border-red-700 bg-red-950/35 text-red-100",
  };

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClasses[tone]}`}>
      <p className="text-xs uppercase tracking-wide opacity-75">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const checkingAuth = useRequireAuth();
  const { data, error } = useSWR<UserAnalytics>(
    checkingAuth ? null : "/api/analytics/me",
    () => api.analytics.me() as Promise<UserAnalytics>,
  );

  const maxBiasCount = Math.max(
    1,
    ...(data?.bias_patterns.map((pattern) => pattern.count) ?? []),
  );
  const maxTrendScore = Math.max(
    1,
    ...(data?.reasoning_trend.map((point) => point.avg_score) ?? []),
  );

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="border-b border-slate-700 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <button
            onClick={() => router.push("/cases")}
            className="text-sm text-slate-400 hover:text-white"
          >
            ← Back to Cases
          </button>
          <h1 className="text-lg font-semibold text-white">Analytics</h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {(checkingAuth || (!data && !error)) && (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
            Could not load analytics. Please try again after completing a session.
          </div>
        )}

        {data && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Reasoning Dashboard</h2>
              <p className="mt-1 text-slate-400">
                Your simulated sessions, cognitive bias patterns, and specialty practice trends.
              </p>
              <p className="mt-2 max-w-3xl text-xs leading-relaxed text-amber-200">
                These analytics are educational simulation metrics only. They are not a
                certification of clinical competence, independent practice readiness, or safe care
                for real patients.
              </p>
            </div>

            <section className="grid gap-4 md:grid-cols-5">
              <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Sessions</p>
                <p className="mt-2 text-3xl font-bold text-white">{data.total_sessions}</p>
                <p className="text-sm text-slate-400">{data.completed_sessions} completed</p>
              </div>
              <div
                className={`rounded-lg border p-4 ${
                  data.safety_summary.open_high_risk_events > 0
                    ? "border-red-700 bg-red-950/35"
                    : "border-slate-700 bg-slate-800"
                }`}
              >
                <p className="text-xs uppercase tracking-wide text-slate-500">Safety Flags</p>
                <p
                  className={`mt-2 text-3xl font-bold ${
                    data.safety_summary.open_high_risk_events > 0
                      ? "text-red-100"
                      : "text-white"
                  }`}
                >
                  {data.safety_summary.open_events}
                </p>
                <p className="text-sm text-slate-400">
                  {data.safety_locked_sessions} locked session
                  {data.safety_locked_sessions === 1 ? "" : "s"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Avg Simulation Score
                </p>
                <p className="mt-2 text-3xl font-bold text-white">
                  {data.avg_reasoning_score.toFixed(0)}
                </p>
                <p className="text-sm text-slate-400">out of 100</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Messages</p>
                <p className="mt-2 text-3xl font-bold text-white">{data.total_messages}</p>
                <p className="text-sm text-slate-400">coach and learner turns</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Tokens</p>
                <p className="mt-2 text-3xl font-bold text-white">
                  {data.total_tokens_used.toLocaleString()}
                </p>
                <p className="text-sm text-slate-400">total usage</p>
              </div>
            </section>

            <section
              className={`rounded-lg border p-5 ${
                data.safety_summary.open_high_risk_events > 0
                  ? "border-red-700 bg-red-950/25"
                  : data.safety_summary.open_events > 0
                    ? "border-amber-700 bg-amber-950/20"
                    : "border-slate-700 bg-slate-800"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-white">Safety Review Snapshot</h3>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
                    Safety events are tracked separately from simulation scores. Open high-risk
                    real-patient, emergency, or privacy events should be reviewed before using
                    performance metrics for coaching decisions.
                  </p>
                </div>
                {data.safety_summary.open_high_risk_events > 0 && (
                  <span className="rounded-full border border-red-700 bg-red-950/50 px-3 py-1 text-xs font-semibold text-red-100">
                    High-risk review needed
                  </span>
                )}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SafetyMetric
                  label="Open Events"
                  value={data.safety_summary.open_events}
                  tone={data.safety_summary.open_events > 0 ? "amber" : "slate"}
                />
                <SafetyMetric
                  label="Open High Risk"
                  value={data.safety_summary.open_high_risk_events}
                  tone={data.safety_summary.open_high_risk_events > 0 ? "red" : "slate"}
                />
                <SafetyMetric
                  label="Privacy Events"
                  value={data.safety_summary.privacy_events}
                  tone={data.safety_summary.privacy_events > 0 ? "red" : "slate"}
                />
                <SafetyMetric
                  label="Management Safety"
                  value={data.safety_summary.management_safety_events}
                  tone={data.safety_summary.management_safety_events > 0 ? "amber" : "slate"}
                />
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
                <h3 className="mb-4 font-semibold text-white">Reasoning Trend</h3>
                {data.reasoning_trend.length === 0 ? (
                  <p className="text-sm text-slate-400">Complete a session to see score trend.</p>
                ) : (
                  <div className="flex h-48 items-end gap-3">
                    {data.reasoning_trend.map((point) => (
                      <div
                        key={`${point.session_number}-${point.date}`}
                        className="flex flex-1 flex-col items-center gap-2"
                      >
                        <div className="flex h-36 w-full items-end rounded bg-slate-900/60 px-1">
                          <div
                            className="w-full rounded-t bg-sky-500"
                            style={{
                              height: `${Math.max(8, (point.avg_score / maxTrendScore) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-slate-400">S{point.session_number}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
                <h3 className="mb-4 font-semibold text-white">Specialty Simulation Practice</h3>
                {Object.keys(data.specialty_performance).length === 0 ? (
                  <p className="text-sm text-slate-400">No completed specialty scores yet.</p>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(data.specialty_performance)
                      .sort((a, b) => b[1] - a[1])
                      .map(([specialty, score]) => (
                        <ScoreBar key={specialty} label={specialty} value={score} />
                      ))}
                  </div>
                )}
              </section>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
                <h3 className="mb-4 font-semibold text-white">Bias Patterns</h3>
                {data.bias_patterns.length === 0 ? (
                  <p className="text-sm text-slate-400">No cognitive bias events detected yet.</p>
                ) : (
                  <div className="space-y-4">
                    {data.bias_patterns.map((pattern) => (
                      <div key={pattern.bias_type}>
                        <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                          <span className="capitalize text-slate-300">
                            {formatLabel(pattern.bias_type)}
                          </span>
                          <span className="text-slate-400">
                            {pattern.count} events · {(pattern.avg_confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-700">
                          <div
                            className="h-2 rounded-full bg-orange-500"
                            style={{ width: `${(pattern.count / maxBiasCount) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
                <h3 className="mb-4 font-semibold text-white">Coaching Focus</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                      Strongest Areas
                    </p>
                    <div className="space-y-2">
                      {(data.strongest_areas.length ? data.strongest_areas : ["Not enough data"]).map(
                        (area) => (
                          <div
                            key={area}
                            className="rounded border border-emerald-700 bg-emerald-900/20 px-3 py-2 text-sm text-emerald-200"
                          >
                            {area}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                      Practice Next
                    </p>
                    <div className="space-y-2">
                      {(data.weakest_areas.length ? data.weakest_areas : ["Complete more sessions"]).map(
                        (area) => (
                          <div
                            key={area}
                            className="rounded border border-amber-700 bg-amber-900/20 px-3 py-2 text-sm text-amber-200"
                          >
                            {area}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
