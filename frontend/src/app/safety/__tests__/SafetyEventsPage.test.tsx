import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SafetyEvent, User } from "@/types";

vi.mock("@/lib/useAuthGate", () => ({
  useRequireAuth: () => false,
}));

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

vi.mock("@/lib/api", () => ({
  api: {
    auth: {
      me: vi.fn(),
    },
    safetyEvents: {
      list: vi.fn(),
      updateResolution: vi.fn(),
    },
  },
}));

import SafetyEventsPage from "@/app/safety/page";
import { api } from "@/lib/api";

const mockMutateSafetyEvents = vi.fn();

const reviewer: User = {
  id: "reviewer-1",
  email: "reviewer@test.com",
  full_name: "Dr Reviewer",
  training_level: "fellow",
  role: "clinician_reviewer",
  accepted_educational_use: true,
  accepted_educational_use_at: "2026-06-01T00:00:00Z",
};

const learner: User = {
  ...reviewer,
  id: "learner-1",
  role: "learner",
};

const safetyEvents: SafetyEvent[] = [
  {
    id: "event-1",
    session_id: "11111111-1111-1111-1111-111111111111",
    case_id: "22222222-2222-2222-2222-222222222222",
    session_status: "safety_locked",
    user_id: "learner-1",
    user_email: "learner@test.com",
    user_full_name: "Learner User",
    event_type: "possible_patient_identifier",
    severity: "high",
    action_taken: "locked_session_blocked_storage_and_coaching",
    detected_terms: ["phone_number", "medical_record_number"],
    message_turn: 2,
    note: "Student message was not stored.",
    status: "open",
    resolution_note: null,
    resolved_at: null,
    resolved_by_user_id: null,
    resolved_by_user_email: null,
    resolved_by_user_full_name: null,
    created_at: "2026-06-02T06:30:00Z",
  },
  {
    id: "event-2",
    session_id: "33333333-3333-3333-3333-333333333333",
    case_id: "44444444-4444-4444-4444-444444444444",
    session_status: "safety_locked",
    user_id: "learner-1",
    user_email: "learner@test.com",
    user_full_name: "Learner User",
    event_type: "real_patient_or_emergency_signal",
    severity: "high",
    action_taken: "locked_session_blocked_storage_and_coaching",
    detected_terms: ["severe chest pain"],
    message_turn: 1,
    note: "Coaching halted for possible real patient or emergency scenario.",
    status: "resolved",
    resolution_note: "Reviewed and documented.",
    resolved_at: "2026-06-02T07:00:00Z",
    resolved_by_user_id: "reviewer-1",
    resolved_by_user_email: "reviewer@test.com",
    resolved_by_user_full_name: "Dr Reviewer",
    created_at: "2026-06-02T06:00:00Z",
  },
  {
    id: "event-3",
    session_id: "55555555-5555-5555-5555-555555555555",
    case_id: "66666666-6666-6666-6666-666666666666",
    session_status: "active",
    user_id: "learner-1",
    user_email: "learner@test.com",
    user_full_name: "Learner User",
    event_type: "management_before_safety_checks",
    severity: "medium",
    action_taken: "coach_redirected_to_safety_checks",
    detected_terms: ["heparin"],
    message_turn: 3,
    note: "Learner committed to simulated management before addressing contraindication checks.",
    status: "open",
    resolution_note: null,
    resolved_at: null,
    resolved_by_user_id: null,
    resolved_by_user_email: null,
    resolved_by_user_full_name: null,
    created_at: "2026-06-02T07:30:00Z",
  },
];

function mockSafetySwr({
  user = reviewer,
  events = safetyEvents,
}: {
  user?: User;
  events?: SafetyEvent[];
} = {}) {
  vi.mocked(useSWR).mockImplementation((key: unknown) => {
    if (key === "/api/auth/me") {
      return { data: user, error: undefined } as ReturnType<typeof useSWR>;
    }
    if (typeof key === "string" && key.startsWith("/api/safety-events")) {
      return {
        data: events,
        error: undefined,
        mutate: mockMutateSafetyEvents,
      } as ReturnType<typeof useSWR>;
    }
    return { data: undefined, error: undefined } as ReturnType<typeof useSWR>;
  });
}

beforeEach(() => {
  mockMutateSafetyEvents.mockReset();
  mockMutateSafetyEvents.mockResolvedValue(undefined);
  vi.mocked(api.safetyEvents.updateResolution).mockReset();
  vi.mocked(api.safetyEvents.updateResolution).mockResolvedValue(undefined);
});

describe("SafetyEventsPage", () => {
  it("blocks learners from the safety event audit log", () => {
    mockSafetySwr({ user: learner });

    render(<SafetyEventsPage />);

    expect(screen.getByText("Clinician reviewer role required.")).toBeTruthy();
    expect(screen.queryByText("Matching High Severity")).toBeFalsy();
  });

  it("renders safety event summaries and event rows for reviewers", () => {
    mockSafetySwr();

    render(<SafetyEventsPage />);

    expect(screen.getByText("Filtered audit summary")).toBeTruthy();
    expect(screen.getByText(/current event type, severity, and status filters/)).toBeTruthy();
    expect(screen.getByText("Matching High Severity")).toBeTruthy();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Patient identifier").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Real patient or emergency").length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: "Coach output guardrail" })).toBeTruthy();
    expect(screen.getAllByText("Management before safety checks").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Learner User").length).toBeGreaterThan(0);
    expect(screen.getByText("phone number")).toBeTruthy();
    expect(screen.getByText("medical record number")).toBeTruthy();
    expect(screen.getByText("heparin")).toBeTruthy();
    expect(screen.getAllByText("locked session blocked storage and coaching").length).toBe(2);
    expect(screen.getByText("coach redirected to safety checks")).toBeTruthy();
    expect(screen.getByText("Reviewed and documented.")).toBeTruthy();
    expect(screen.getAllByText("Session safety locked").length).toBe(2);
    expect(screen.getByText("Session active")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open locked session context" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open session context" })).toHaveAttribute(
      "href",
      "/sessions/55555555-5555-5555-5555-555555555555",
    );
    expect(screen.getAllByRole("link", { name: "Open case review" })).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: "Open locked session context" })[0]).toHaveAttribute(
      "href",
      "/sessions/11111111-1111-1111-1111-111111111111",
    );
    expect(screen.getAllByRole("link", { name: "Open case review" })[0]).toHaveAttribute(
      "href",
      "/review?case=22222222-2222-2222-2222-222222222222",
    );
    expect(screen.getByText("Session remains safety locked.")).toBeTruthy();
    expect(
      screen.getAllByText(/Use at least 20 characters and mention review/)
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/High-risk lock events also need escalation/)
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
  });

  it("refreshes the safety event list on demand", async () => {
    mockSafetySwr();

    render(<SafetyEventsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(mockMutateSafetyEvents).toHaveBeenCalledOnce());
  });

  it("requires a resolution note before marking an event resolved", async () => {
    mockSafetySwr({ events: [safetyEvents[0]] });

    render(<SafetyEventsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Resolved" }));

    expect(
      await screen.findByText("Resolution note is required before marking an event resolved."),
    ).toBeTruthy();
    expect(api.safetyEvents.updateResolution).not.toHaveBeenCalled();
  });

  it("requires a substantive resolution note before marking an event resolved", async () => {
    mockSafetySwr({ events: [safetyEvents[0]] });

    render(<SafetyEventsPage />);
    const noteInput = screen.getByLabelText("Resolution note for event-1");

    fireEvent.change(noteInput, { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark Resolved" }));
    expect(
      await screen.findByText("Resolution note must summarize the safety review or escalation."),
    ).toBeTruthy();
    expect(api.safetyEvents.updateResolution).not.toHaveBeenCalled();

    fireEvent.change(noteInput, {
      target: { value: "Learner finished the session successfully." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark Resolved" }));
    expect(
      await screen.findByText(
        "Resolution note must mention review, escalation, or how the issue was addressed.",
      ),
    ).toBeTruthy();
    expect(api.safetyEvents.updateResolution).not.toHaveBeenCalled();

    fireEvent.change(noteInput, {
      target: { value: "Reviewed and documented the safety audit." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark Resolved" }));
    expect(
      await screen.findByText(
        "High-risk lock events require escalation, supervision, privacy handling, local protocol, or not-patient-care documentation.",
      ),
    ).toBeTruthy();
    expect(api.safetyEvents.updateResolution).not.toHaveBeenCalled();
  });

  it("marks an open safety event resolved", async () => {
    mockSafetySwr({ events: [safetyEvents[0]] });

    render(<SafetyEventsPage />);
    fireEvent.change(screen.getByLabelText("Resolution note for event-1"), {
      target: { value: "Reviewed and documented with supervising clinician." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark Resolved" }));

    await waitFor(() =>
      expect(api.safetyEvents.updateResolution).toHaveBeenCalledWith("event-1", {
        status: "resolved",
        resolution_note: "Reviewed and documented with supervising clinician.",
      }),
    );
    expect(mockMutateSafetyEvents).toHaveBeenCalledOnce();
    expect(await screen.findByText("Safety event marked resolved.")).toBeTruthy();
  });

  it("reopens a resolved safety event", async () => {
    mockSafetySwr({ events: [safetyEvents[1]] });

    render(<SafetyEventsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));

    await waitFor(() =>
      expect(api.safetyEvents.updateResolution).toHaveBeenCalledWith("event-2", {
        status: "open",
      }),
    );
    expect(mockMutateSafetyEvents).toHaveBeenCalledOnce();
    expect(await screen.findByText("Safety event reopened.")).toBeTruthy();
  });
});
