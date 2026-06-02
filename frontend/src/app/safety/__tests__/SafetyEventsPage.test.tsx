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
    },
  },
}));

import SafetyEventsPage from "@/app/safety/page";

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
    user_id: "learner-1",
    user_email: "learner@test.com",
    user_full_name: "Learner User",
    event_type: "possible_patient_identifier",
    severity: "high",
    action_taken: "blocked_storage_and_coaching",
    detected_terms: ["phone_number", "medical_record_number"],
    message_turn: 2,
    note: "Student message was not stored.",
    created_at: "2026-06-02T06:30:00Z",
  },
  {
    id: "event-2",
    session_id: "33333333-3333-3333-3333-333333333333",
    case_id: "44444444-4444-4444-4444-444444444444",
    user_id: "learner-1",
    user_email: "learner@test.com",
    user_full_name: "Learner User",
    event_type: "real_patient_or_emergency_signal",
    severity: "high",
    action_taken: "halted_coaching",
    detected_terms: ["severe chest pain"],
    message_turn: 1,
    note: "Coaching halted for possible real patient or emergency scenario.",
    created_at: "2026-06-02T06:00:00Z",
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
});

describe("SafetyEventsPage", () => {
  it("blocks learners from the safety event audit log", () => {
    mockSafetySwr({ user: learner });

    render(<SafetyEventsPage />);

    expect(screen.getByText("Clinician reviewer role required.")).toBeTruthy();
    expect(screen.queryByText("High Severity")).toBeFalsy();
  });

  it("renders safety event summaries and event rows for reviewers", () => {
    mockSafetySwr();

    render(<SafetyEventsPage />);

    expect(screen.getByText("High Severity")).toBeTruthy();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Patient identifier").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Real patient or emergency").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Learner User").length).toBeGreaterThan(0);
    expect(screen.getByText("phone number")).toBeTruthy();
    expect(screen.getByText("medical record number")).toBeTruthy();
    expect(screen.getByText("halted coaching")).toBeTruthy();
  });

  it("refreshes the safety event list on demand", async () => {
    mockSafetySwr();

    render(<SafetyEventsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(mockMutateSafetyEvents).toHaveBeenCalledOnce());
  });
});
