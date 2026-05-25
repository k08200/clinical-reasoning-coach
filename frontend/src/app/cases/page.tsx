"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/api";
import { logout } from "@/lib/auth";
import { useRequireAuth } from "@/lib/useAuthGate";
import type { ClinicalCase } from "@/types";

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

export default function CasesPage() {
  const router = useRouter();
  const checkingAuth = useRequireAuth();
  const [specialty, setSpecialty] = useState("All");
  const [generating, setGenerating] = useState(false);
  const [startingSession, setStartingSession] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: cases, error: casesError, mutate } = useSWR<ClinicalCase[]>(
    checkingAuth ? null : `/api/cases?${specialty !== "All" ? `specialty=${specialty}` : ""}`,
    () =>
      api.cases.list(specialty !== "All" ? { specialty } : undefined) as Promise<ClinicalCase[]>,
  );
  const caseList = cases ?? [];

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

  async function handleStartSession(caseId: string) {
    setStartingSession(caseId);
    setActionError("");
    try {
      const session = await api.sessions.create(caseId) as { id: string };
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Could not start the session");
      setStartingSession(null);
    }
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
            <a href="/sessions/history" className="text-sm text-slate-400 hover:text-white">
              My Sessions
            </a>
            <a href="/analytics" className="text-sm text-slate-400 hover:text-white">
              Analytics
            </a>
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
            {caseList.map((c) => (
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
                  {c.patient_demographics.age}yo {c.patient_demographics.sex}
                </p>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{c.times_used} sessions</span>
                  <button
                    onClick={() => handleStartSession(c.id)}
                    disabled={startingSession === c.id}
                    className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
                  >
                    {startingSession === c.id ? "Starting..." : "Start Session"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
