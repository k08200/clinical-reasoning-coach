"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/useAuthGate";
import type {
  ReviewerCredentialEvent,
  ReviewerVerificationStatus,
  User,
  UserRole,
} from "@/types";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "learner", label: "Learner" },
  { value: "clinician_reviewer", label: "Clinician reviewer" },
  { value: "admin", label: "Admin" },
];
const REVIEWER_VERIFICATION_OPTIONS: {
  value: Extract<ReviewerVerificationStatus, "verified" | "suspended">;
  label: string;
}[] = [
  { value: "verified", label: "Verified" },
  { value: "suspended", label: "Suspended" },
];

function roleBadgeClasses(role: UserRole): string {
  if (role === "admin") return "border-violet-700 bg-violet-950/40 text-violet-200";
  if (role === "clinician_reviewer") {
    return "border-emerald-700 bg-emerald-950/30 text-emerald-200";
  }
  return "border-slate-700 bg-slate-900/60 text-slate-300";
}

export default function AdminUsersPage() {
  const checkingAuth = useRequireAuth();
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [verificationDrafts, setVerificationDrafts] = useState<
    Record<
      string,
      { status: "verified" | "suspended"; practice_scope: string; verification_note: string }
    >
  >({});
  const [verificationHistory, setVerificationHistory] = useState<
    Record<string, ReviewerCredentialEvent[]>
  >({});
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [verifyingUserId, setVerifyingUserId] = useState<string | null>(null);
  const [loadingHistoryUserId, setLoadingHistoryUserId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const { data: currentUser, error: currentUserError } = useSWR<User>(
    checkingAuth ? null : "/api/auth/me",
    () => api.auth.me() as Promise<User>,
  );
  const isAdmin = currentUser?.role === "admin";
  const {
    data: users,
    error: usersError,
    mutate: mutateUsers,
  } = useSWR<User[]>(
    isAdmin ? "/api/auth/users" : null,
    () => api.auth.listUsers() as Promise<User[]>,
  );

  async function handleSave(user: User) {
    const nextRole = roleDrafts[user.id] ?? user.role;
    setUpdatingUserId(user.id);
    setActionError("");
    setActionMessage("");

    try {
      await api.auth.updateUserRole(user.id, { role: nextRole });
      await mutateUsers();
      setRoleDrafts((current) => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
      setActionMessage(`${user.full_name} role updated.`);
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Could not update user role");
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function handleReviewerVerification(user: User) {
    const draft = verificationDrafts[user.id] ?? {
      status:
        user.reviewer_verification_status === "suspended" ? "suspended" : "verified",
      practice_scope: user.reviewer_practice_scope ?? "",
      verification_note: "",
    };
    setVerifyingUserId(user.id);
    setActionError("");
    setActionMessage("");

    try {
      await api.auth.updateReviewerVerification(user.id, {
        status: draft.status,
        practice_scope: draft.practice_scope.trim() || undefined,
        verification_note: draft.verification_note.trim(),
      });
      const history = await api.auth.listReviewerVerificationHistory(user.id);
      setVerificationHistory((current) => ({ ...current, [user.id]: history }));
      await mutateUsers();
      setVerificationDrafts((current) => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
      setActionMessage(`${user.full_name} reviewer verification updated.`);
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Could not update reviewer verification");
    } finally {
      setVerifyingUserId(null);
    }
  }

  async function handleLoadVerificationHistory(user: User) {
    setLoadingHistoryUserId(user.id);
    setActionError("");

    try {
      const history = await api.auth.listReviewerVerificationHistory(user.id);
      setVerificationHistory((current) => ({ ...current, [user.id]: history }));
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : "Could not load credential history");
    } finally {
      setLoadingHistoryUserId(null);
    }
  }

  if (checkingAuth || (!currentUser && !currentUserError)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (!currentUser || currentUserError || !isAdmin) {
    return (
      <div className="min-h-screen bg-slate-900">
        <header className="border-b border-slate-700 px-6 py-4">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <Link href="/cases" className="text-sm text-slate-400 hover:text-white">
              Back to Cases
            </Link>
            <h1 className="text-lg font-semibold text-white">User Administration</h1>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <div className="rounded-lg border border-amber-700 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            Admin role required.
          </div>
          <Link
            href="/admin/bootstrap"
            className="mt-4 inline-block text-sm font-medium text-sky-300 hover:text-sky-200"
          >
            Initial Admin Setup
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="border-b border-slate-700 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">User Administration</h1>
            <p className="text-xs text-slate-400">Reviewer and admin role management</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/cases" className="text-sm text-slate-400 hover:text-white">
              Cases
            </Link>
            <Link href="/review" className="text-sm text-slate-400 hover:text-white">
              Clinical Review
            </Link>
            <Link href="/safety" className="text-sm text-slate-400 hover:text-white">
              Safety Events
            </Link>
            <Link href="/admin/governance" className="text-sm text-slate-400 hover:text-white">
              Governance
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total Users</p>
            <p className="mt-2 text-3xl font-bold text-white">{users?.length ?? 0}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Reviewers</p>
            <p className="mt-2 text-3xl font-bold text-white">
              {(users ?? []).filter((user) => user.role === "clinician_reviewer").length}
            </p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Admins</p>
            <p className="mt-2 text-3xl font-bold text-white">
              {(users ?? []).filter((user) => user.role === "admin").length}
            </p>
          </div>
        </div>

        {(usersError || actionError) && (
          <div className="mb-6 rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
            {actionError || "Could not load users."}
          </div>
        )}
        {actionMessage && (
          <div className="mb-6 rounded-lg border border-emerald-700 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
            {actionMessage}
          </div>
        )}

        {!users && !usersError ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        ) : users?.length === 0 ? (
          <div className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-8 text-center text-slate-400">
            No registered users.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800">
            <div className="grid min-w-[48rem] grid-cols-[minmax(0,1.5fr)_minmax(8rem,0.7fr)_minmax(12rem,0.8fr)_minmax(8rem,0.5fr)] gap-4 border-b border-slate-700 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>User</span>
              <span>Current Role</span>
              <span>Set Role</span>
              <span className="text-right">Action</span>
            </div>
            <div className="divide-y divide-slate-700">
              {users?.map((managedUser) => {
                const selectedRole = roleDrafts[managedUser.id] ?? managedUser.role;
                const changed = selectedRole !== managedUser.role;
                const verificationDraft = verificationDrafts[managedUser.id] ?? {
                  status:
                    managedUser.reviewer_verification_status === "suspended"
                      ? "suspended"
                      : "verified",
                  practice_scope: managedUser.reviewer_practice_scope ?? "",
                  verification_note: "",
                };
                const removingOwnAdmin =
                  managedUser.id === currentUser.id && selectedRole !== "admin";
                const canManageVerification =
                  managedUser.role === "clinician_reviewer" &&
                  managedUser.id !== currentUser.id;

                return (
                  <div
                    key={managedUser.id}
                    className="grid min-w-[48rem] grid-cols-[minmax(0,1.5fr)_minmax(8rem,0.7fr)_minmax(12rem,0.8fr)_minmax(8rem,0.5fr)] items-center gap-4 px-4 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {managedUser.full_name}
                      </p>
                      <p className="truncate text-xs text-slate-400">{managedUser.email}</p>
                      {!managedUser.accepted_educational_use && (
                        <p className="mt-1 text-xs text-amber-300">Consent pending</p>
                      )}
                    </div>
                    <div>
                      <span
                        className={`rounded-full border px-2 py-1 text-xs font-medium ${roleBadgeClasses(
                          managedUser.role,
                        )}`}
                      >
                        {managedUser.role.replace(/_/g, " ")}
                      </span>
                      {managedUser.role === "clinician_reviewer" && (
                        <p className="mt-2 text-xs text-slate-400">
                          Verification: {managedUser.reviewer_credential_current === false
                            ? "expired"
                            : managedUser.reviewer_verification_status ?? "pending"}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="sr-only" htmlFor={`role-${managedUser.id}`}>
                        Role for {managedUser.full_name}
                      </label>
                      <select
                        id={`role-${managedUser.id}`}
                        value={selectedRole}
                        onChange={(event) =>
                          setRoleDrafts((current) => ({
                            ...current,
                            [managedUser.id]: event.target.value as UserRole,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                      {canManageVerification && (
                        <>
                          <label className="sr-only" htmlFor={`scope-${managedUser.id}`}>
                            Practice scope for {managedUser.full_name}
                          </label>
                          <input
                            id={`scope-${managedUser.id}`}
                            value={verificationDraft.practice_scope}
                            onChange={(event) =>
                              setVerificationDrafts((current) => ({
                                ...current,
                                [managedUser.id]: {
                                  ...verificationDraft,
                                  practice_scope: event.target.value,
                                },
                              }))
                            }
                            placeholder="Clinical practice scope"
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                          />
                          <label className="sr-only" htmlFor={`verification-${managedUser.id}`}>
                            Verification status for {managedUser.full_name}
                          </label>
                          <select
                            id={`verification-${managedUser.id}`}
                            value={verificationDraft.status}
                            onChange={(event) =>
                              setVerificationDrafts((current) => ({
                                ...current,
                                [managedUser.id]: {
                                  ...verificationDraft,
                                  status: event.target.value as "verified" | "suspended",
                                },
                              }))
                            }
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                          >
                            {REVIEWER_VERIFICATION_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <label className="sr-only" htmlFor={`verification-note-${managedUser.id}`}>
                            Credential review note for {managedUser.full_name}
                          </label>
                          <textarea
                            id={`verification-note-${managedUser.id}`}
                            value={verificationDraft.verification_note}
                            onChange={(event) =>
                              setVerificationDrafts((current) => ({
                                ...current,
                                [managedUser.id]: {
                                  ...verificationDraft,
                                  verification_note: event.target.value,
                                },
                              }))
                            }
                            placeholder="Credential review note"
                            className="min-h-20 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                          />
                          {verificationHistory[managedUser.id] && (
                            <ul
                              aria-label={`Credential history for ${managedUser.full_name}`}
                              className="space-y-2 border-l border-slate-700 pl-3 text-xs text-slate-400"
                            >
                              {verificationHistory[managedUser.id].map((event) => (
                                <li key={event.id}>
                                  <p className="font-medium text-slate-200">
                                    {event.action.replace(/_/g, " ")} ({event.resulting_verification_status})
                                  </p>
                                  <p>{event.verification_note}</p>
                                  <p>{new Date(event.created_at).toLocaleString()}</p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      )}
                    </div>
                    <div className="text-right">
                      <button
                        onClick={() => handleSave(managedUser)}
                        disabled={!changed || removingOwnAdmin || updatingUserId === managedUser.id}
                        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {updatingUserId === managedUser.id ? "Saving..." : "Save"}
                      </button>
                      {removingOwnAdmin && (
                        <p className="mt-1 text-xs text-amber-300">Cannot demote yourself</p>
                      )}
                      {canManageVerification && (
                        <>
                          <button
                            onClick={() => handleReviewerVerification(managedUser)}
                            disabled={
                              verifyingUserId === managedUser.id ||
                              verificationDraft.verification_note.trim().length < 10
                            }
                            className="mt-2 rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {verifyingUserId === managedUser.id
                              ? "Updating..."
                              : "Update Verification"}
                          </button>
                          <button
                            onClick={() => handleLoadVerificationHistory(managedUser)}
                            disabled={loadingHistoryUserId === managedUser.id}
                            className="mt-2 text-sm font-medium text-sky-300 hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {loadingHistoryUserId === managedUser.id
                              ? "Loading..."
                              : "View History"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
