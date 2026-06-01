"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/useAuthGate";

export default function EducationalUseConsentPage() {
  const router = useRouter();
  const checkingAuth = useRequireAuth({ allowPendingConsent: true });
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.auth.acceptEducationalUseConsent({
        accepted_educational_use: accepted,
      });
      router.replace("/cases");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save consent");
    } finally {
      setLoading(false);
    }
  }

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold text-white">Clinical Reasoning Coach</h1>
          <p className="text-slate-400">Educational use confirmation</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-xl"
        >
          <h2 className="mb-3 text-xl font-semibold text-white">Before continuing</h2>
          <p className="mb-5 text-sm leading-6 text-slate-300">
            This app is for simulated clinical reasoning practice. It is not a medical
            device, patient-care tool, diagnostic system, or emergency service.
          </p>

          {error && (
            <div className="mb-4 rounded-lg border border-red-700 bg-red-900/50 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <label className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-100">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-amber-500 bg-slate-900 text-brand-600 focus:ring-brand-500"
            />
            <span>
              I understand this is an educational simulation, not patient care, and I
              will not use it for real patients or emergencies.
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !accepted}
            className="mt-6 w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
