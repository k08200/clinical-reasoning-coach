"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/useAuthGate";
import type { User, UserRole } from "@/types";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "learner", label: "Learner" },
  { value: "clinician_reviewer", label: "Clinician reviewer" },
  { value: "admin", label: "Admin" },
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
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
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
                const removingOwnAdmin =
                  managedUser.id === currentUser.id && selectedRole !== "admin";

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
                    </div>
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
