"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/useAuthGate";
import type { User } from "@/types";

export default function AdminBootstrapPage() {
  const router = useRouter();
  const checkingAuth = useRequireAuth();
  const [setupToken, setSetupToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  const { data: currentUser, error: currentUserError } = useSWR<User>(
    checkingAuth ? null : "/api/auth/me",
    () => api.auth.me() as Promise<User>,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setActionError("");

    try {
      await api.auth.bootstrapAdmin({ setup_token: setupToken.trim() });
      router.push("/admin/users");
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Could not complete admin setup");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingAuth || (!currentUser && !currentUserError)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="border-b border-slate-700 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Admin Setup</h1>
            <p className="text-xs text-slate-400">Initial administrator bootstrap</p>
          </div>
          <Link href="/cases" className="text-sm text-slate-400 hover:text-white">
            Cases
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="max-w-xl rounded-lg border border-slate-700 bg-slate-800 p-6">
          <div className="mb-6">
            <p className="text-sm font-semibold text-white">
              {currentUser?.full_name ?? "Signed-in user"}
            </p>
            <p className="text-sm text-slate-400">{currentUser?.email}</p>
          </div>

          {currentUserError && (
            <div className="mb-4 rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
              Could not load your account.
            </div>
          )}
          {actionError && (
            <div className="mb-4 rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
              {actionError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block text-sm font-medium text-slate-300">
              Setup Token
              <input
                type="password"
                value={setupToken}
                onChange={(event) => setSetupToken(event.target.value)}
                required
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-brand-500"
              />
            </label>
            <button
              type="submit"
              disabled={!setupToken.trim() || submitting || !!currentUserError}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Completing..." : "Complete Setup"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
