"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/useAuthGate";
import type { SafetyEvent, User } from "@/types";

const EVENT_TYPE_OPTIONS = [
  { value: "all", label: "All events" },
  { value: "real_patient_or_emergency_signal", label: "Real patient or emergency" },
  { value: "possible_patient_identifier", label: "Patient identifier" },
  { value: "management_before_safety_checks", label: "Management before safety checks" },
];

const SEVERITY_OPTIONS = [
  { value: "all", label: "All severity" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "all", label: "All status" },
  { value: "resolved", label: "Resolved" },
];

function isReviewer(user: User | undefined): boolean {
  return user?.role === "clinician_reviewer" || user?.role === "admin";
}

function eventLabel(eventType: string): string {
  if (eventType === "real_patient_or_emergency_signal") {
    return "Real patient or emergency";
  }
  if (eventType === "possible_patient_identifier") return "Patient identifier";
  if (eventType === "management_before_safety_checks") {
    return "Management before safety checks";
  }
  return eventType.replace(/_/g, " ");
}

function badgeClasses(value: string): string {
  if (value === "high") return "border-red-700 bg-red-950/40 text-red-200";
  if (value === "medium") return "border-amber-700 bg-amber-950/40 text-amber-200";
  if (value === "low") return "border-sky-700 bg-sky-950/40 text-sky-200";
  return "border-slate-700 bg-slate-900/60 text-slate-300";
}

function statusBadgeClasses(value: SafetyEvent["status"]): string {
  if (value === "resolved") return "border-emerald-700 bg-emerald-950/40 text-emerald-200";
  return "border-amber-700 bg-amber-950/40 text-amber-200";
}

function sessionStatusBadgeClasses(value: string): string {
  if (value === "safety_locked") return "border-red-700 bg-red-950/40 text-red-200";
  return "border-slate-700 bg-slate-900/60 text-slate-300";
}

function sessionStatusLabel(value: string): string {
  if (value === "safety_locked") return "Session safety locked";
  return `Session ${value.replace(/_/g, " ")}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function SafetyEventsPage() {
  const checkingAuth = useRequireAuth();
  const [eventType, setEventType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [eventStatus, setEventStatus] = useState("open");
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, string>>({});
  const [updatingEventId, setUpdatingEventId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const { data: user, error: userError } = useSWR<User>(
    checkingAuth ? null : "/api/auth/me",
    () => api.auth.me() as Promise<User>,
  );
  const reviewer = isReviewer(user);
  const canLoadSafetyEvents = !!user && reviewer;
  const safetyParams = {
    event_type: eventType === "all" ? undefined : eventType,
    severity: severity === "all" ? undefined : severity,
    event_status: eventStatus === "all" ? undefined : eventStatus,
    limit: 100,
  };

  const { data: safetyEvents, error: safetyError, mutate } = useSWR<SafetyEvent[]>(
    canLoadSafetyEvents
      ? `/api/safety-events?event_type=${eventType}&severity=${severity}&event_status=${eventStatus}`
      : null,
    () => api.safetyEvents.list(safetyParams) as Promise<SafetyEvent[]>,
  );

  const summary = useMemo(() => {
    const events = safetyEvents ?? [];
    return {
      total: events.length,
      high: events.filter((event) => event.severity === "high").length,
      open: events.filter((event) => event.status === "open").length,
      resolved: events.filter((event) => event.status === "resolved").length,
    };
  }, [safetyEvents]);

  async function handleResolve(event: SafetyEvent) {
    const resolutionNote = (resolutionDrafts[event.id] ?? "").trim();
    if (!resolutionNote) {
      setActionError("Resolution note is required before marking an event resolved.");
      setActionMessage(null);
      return;
    }

    setUpdatingEventId(event.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.safetyEvents.updateResolution(event.id, {
        status: "resolved",
        resolution_note: resolutionNote,
      });
      setResolutionDrafts((drafts) => {
        const next = { ...drafts };
        delete next[event.id];
        return next;
      });
      await mutate();
      setActionMessage("Safety event marked resolved.");
    } catch {
      setActionError("Could not update safety event resolution.");
    } finally {
      setUpdatingEventId(null);
    }
  }

  async function handleReopen(event: SafetyEvent) {
    setUpdatingEventId(event.id);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.safetyEvents.updateResolution(event.id, { status: "open" });
      await mutate();
      setActionMessage("Safety event reopened.");
    } catch {
      setActionError("Could not reopen safety event.");
    } finally {
      setUpdatingEventId(null);
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
      <div className="min-h-screen bg-slate-900">
        <header className="border-b border-slate-700 px-6 py-4">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <Link href="/cases" className="text-sm text-slate-400 hover:text-white">
              Back to Cases
            </Link>
            <h1 className="text-lg font-semibold text-white">Safety Events</h1>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <div className="rounded-lg border border-amber-700 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            Clinician reviewer role required.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="border-b border-slate-700 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Safety Events</h1>
            <p className="text-xs text-slate-400">Real patient and privacy audit log</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/cases" className="text-sm text-slate-400 hover:text-white">
              Cases
            </Link>
            <Link href="/review" className="text-sm text-slate-400 hover:text-white">
              Clinical Review
            </Link>
            {user.role === "admin" && (
              <Link href="/admin/users" className="text-sm text-slate-400 hover:text-white">
                User Admin
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Events</p>
            <p className="mt-2 text-3xl font-bold text-white">{summary.total}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Open</p>
            <p className="mt-2 text-3xl font-bold text-amber-200">{summary.open}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Resolved</p>
            <p className="mt-2 text-3xl font-bold text-emerald-200">{summary.resolved}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">High Severity</p>
            <p className="mt-2 text-3xl font-bold text-red-200">{summary.high}</p>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Event Type
            </span>
            <select
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              className="w-64 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
            >
              {EVENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Severity
            </span>
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              className="w-48 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
            >
              {SEVERITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Status
            </span>
            <select
              value={eventStatus}
              onChange={(event) => setEventStatus(event.target.value)}
              className="w-44 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => mutate()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Refresh
          </button>
        </div>

        {safetyError && (
          <div className="mb-6 rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
            Could not load safety events.
          </div>
        )}

        {actionError && (
          <div className="mb-6 rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
            {actionError}
          </div>
        )}

        {actionMessage && (
          <div className="mb-6 rounded-lg border border-emerald-700 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
            {actionMessage}
          </div>
        )}

        {!safetyEvents && !safetyError ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          </div>
        ) : safetyEvents?.length === 0 ? (
          <div className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-8 text-center text-slate-400">
            No safety events match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800">
            <div className="grid min-w-[82rem] grid-cols-[minmax(10rem,0.8fr)_minmax(12rem,1fr)_minmax(10rem,0.9fr)_minmax(12rem,1.1fr)_minmax(12rem,1fr)_minmax(18rem,1.3fr)] gap-4 border-b border-slate-700 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>Time</span>
              <span>Learner</span>
              <span>Event</span>
              <span>Detected</span>
              <span>Action</span>
              <span>Resolution</span>
            </div>
            <div className="divide-y divide-slate-700">
              {safetyEvents?.map((event) => (
                <div
                  key={event.id}
                  className="grid min-w-[82rem] grid-cols-[minmax(10rem,0.8fr)_minmax(12rem,1fr)_minmax(10rem,0.9fr)_minmax(12rem,1.1fr)_minmax(12rem,1fr)_minmax(18rem,1.3fr)] gap-4 px-4 py-4"
                >
                  <div>
                    <p className="text-sm font-medium text-white">
                      {formatDate(event.created_at)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Turn {event.message_turn}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {event.user_full_name}
                    </p>
                    <p className="truncate text-xs text-slate-400">{event.user_email}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      Session {event.session_id.slice(0, 8)}
                    </p>
                    <span
                      className={`mt-2 inline-block rounded-full border px-2 py-1 text-xs font-medium ${sessionStatusBadgeClasses(
                        event.session_status,
                      )}`}
                    >
                      {sessionStatusLabel(event.session_status)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {eventLabel(event.event_type)}
                    </p>
                    <span
                      className={`mt-2 inline-block rounded-full border px-2 py-1 text-xs font-medium ${badgeClasses(
                        event.severity,
                      )}`}
                    >
                      {event.severity}
                    </span>
                  </div>
                  <div>
                    <div className="flex flex-wrap gap-1">
                      {event.detected_terms.map((term) => (
                        <span
                          key={term}
                          className="rounded-full border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                        >
                          {term.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {event.action_taken.replace(/_/g, " ")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{event.note}</p>
                  </div>
                  <div>
                    <span
                      className={`inline-block rounded-full border px-2 py-1 text-xs font-medium ${statusBadgeClasses(
                        event.status,
                      )}`}
                    >
                      {event.status}
                    </span>
                    {event.status === "resolved" ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs leading-5 text-slate-300">
                          {event.resolution_note}
                        </p>
                        <p className="text-xs text-slate-500">
                          {event.resolved_by_user_full_name ?? "Reviewer"}
                          {event.resolved_at ? `, ${formatDate(event.resolved_at)}` : ""}
                        </p>
                        {event.session_status === "safety_locked" && (
                          <p className="text-xs leading-5 text-red-200">
                            Session remains safety locked.
                          </p>
                        )}
                        <button
                          onClick={() => void handleReopen(event)}
                          disabled={updatingEventId === event.id}
                          className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Reopen
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <textarea
                          aria-label={`Resolution note for ${event.id}`}
                          value={resolutionDrafts[event.id] ?? ""}
                          onChange={(changeEvent) =>
                            setResolutionDrafts((drafts) => ({
                              ...drafts,
                              [event.id]: changeEvent.target.value,
                            }))
                          }
                          rows={3}
                          maxLength={2000}
                          placeholder="Document escalation, privacy review, or false-positive rationale"
                          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white outline-none transition-colors placeholder:text-slate-600 focus:border-brand-500"
                        />
                        <p className="text-xs leading-5 text-slate-400">
                          Resolving audits the event only; safety-locked sessions remain locked.
                        </p>
                        <button
                          onClick={() => void handleResolve(event)}
                          disabled={updatingEventId === event.id}
                          className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Mark Resolved
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
