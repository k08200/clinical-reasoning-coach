"use client";

import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { CoachingSession } from "@/types";

const STATUS_BADGE = {
  active: "text-green-400 bg-green-900/30",
  completed: "text-blue-400 bg-blue-900/30",
  abandoned: "text-slate-400 bg-slate-800",
};

export default function SessionHistoryPage() {
  const router = useRouter();
  const { data: sessions } = useSWR<CoachingSession[]>(
    "/api/sessions",
    () => api.sessions.list() as Promise<CoachingSession[]>,
  );

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="border-b border-slate-700 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <button
            onClick={() => router.push("/cases")}
            className="text-slate-400 hover:text-white text-sm"
          >
            ← Back to Cases
          </button>
          <h1 className="text-lg font-semibold text-white">Session History</h1>
          <button
            onClick={() => router.push("/analytics")}
            className="text-slate-400 hover:text-white text-sm"
          >
            Analytics
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {!sessions ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            No sessions yet. Start a case to begin!
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => router.push(`/sessions/${s.id}`)}
                className="bg-slate-800 border border-slate-700 rounded-xl p-5 cursor-pointer hover:border-slate-600 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                      STATUS_BADGE[s.status]
                    }`}
                  >
                    {s.status}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(s.started_at).toLocaleDateString()}
                  </span>
                </div>

                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Reasoning Score</p>
                    <p className="text-xl font-bold text-white">
                      {s.final_reasoning_score?.toFixed(0) ?? "—"}
                      <span className="text-sm text-slate-400 font-normal">/100</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Tokens Used</p>
                    <p className="text-sm font-semibold text-white">
                      {(
                        s.total_input_tokens +
                        s.total_output_tokens +
                        s.total_thinking_tokens
                      ).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Top Biases</p>
                    <p className="text-sm text-slate-300">
                      {Object.entries(s.bias_summary)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 2)
                        .map(([k]) => k.replace(/_/g, " "))
                        .join(", ") || "None"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
