import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClinicalCase } from "@/types";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

const mockGenerateDemo = vi.fn();
const mockCreateSession = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    cases: {
      list: vi.fn(),
      generateDemo: (...args: unknown[]) => mockGenerateDemo(...args),
    },
    sessions: {
      create: (...args: unknown[]) => mockCreateSession(...args),
    },
  },
}));

const mockLogout = vi.fn();
vi.mock("@/lib/auth", () => ({
  logout: () => mockLogout(),
}));

vi.mock("@/lib/useAuthGate", () => ({
  useRequireAuth: () => false,
}));

import CasesPage from "@/app/cases/page";

const mockMutate = vi.fn();

const makeCase = (overrides: Partial<ClinicalCase> = {}): ClinicalCase => ({
  id: "case-1",
  title: "Chest Pain With Borderline Troponin",
  specialty: "internal_medicine",
  difficulty: "medium",
  chief_complaint: "Chest pain",
  patient_demographics: {
    age: 54,
    sex: "female",
  },
  history_of_present_illness: "Two hours of pressure-like chest pain.",
  past_medical_history: "Hypertension",
  medications: ["lisinopril"],
  physical_exam: {
    vitals: {
      bp: "148/88",
      hr: 94,
      rr: 18,
      temp_c: 37,
      spo2: 98,
    },
    general: "Uncomfortable",
    cardiovascular: "Regular rhythm",
    pulmonary: "Clear",
    abdomen: "Soft",
    neuro: "Alert",
  },
  initial_labs: { troponin: "0.03" },
  source_provenance: {
    source_count: 1,
    organizations: ["American Heart Association / American College of Cardiology"],
    review_status: "educational_draft",
    review_label: "Educational draft",
    requires_caution: true,
    last_reviewed_at: "2026-06-01",
    review_valid_until: "2027-06-01",
    review_stale: false,
    review_date_invalid: false,
    review_content_changed: false,
  },
  times_used: 2,
  created_at: "2026-05-25T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  mockPush.mockClear();
  mockGenerateDemo.mockReset();
  mockCreateSession.mockReset();
  mockLogout.mockReset();
  mockMutate.mockReset();
  mockMutate.mockResolvedValue(undefined);
});

describe("CasesPage", () => {
  it("shows a loading spinner while cases load", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: undefined,
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    const { container } = render(<CasesPage />);

    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows a retry state when cases fail to load", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: undefined,
      error: new Error("failed"),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    const { container } = render(<CasesPage />);

    expect(screen.getByText("Cases could not be loaded")).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeFalsy();

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(mockMutate).toHaveBeenCalledOnce();
  });

  it("requires acknowledgement before starting an unreviewed case", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [makeCase()],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockCreateSession.mockResolvedValue({ id: "session-1" });

    render(<CasesPage />);

    expect(screen.getByText("1 clinical source")).toBeTruthy();
    expect(screen.getByText("Educational draft")).toBeTruthy();
    expect(screen.getByText("Not clinician reviewed; use only for education.")).toBeTruthy();
    expect(
      screen.getByText("American Heart Association / American College of Cardiology"),
    ).toBeTruthy();
    expect(screen.getByText("Reviewed 2026-06-01 · Valid until 2027-06-01")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));

    expect(
      screen.getByText("This case is not clinician reviewed. Start only as educational simulation."),
    ).toBeTruthy();
    expect(mockCreateSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge and Start" }));

    await waitFor(() => expect(mockCreateSession).toHaveBeenCalledWith("case-1", {
      acknowledge_unreviewed_case: true,
    }));
    expect(mockPush).toHaveBeenCalledWith("/sessions/session-1");
  });

  it("renders older adult age buckets without appending yo", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [makeCase({ patient_demographics: { age: "90 or older", sex: "female" } })],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    render(<CasesPage />);

    expect(screen.getByText("90 or older female")).toBeTruthy();
    expect(screen.queryByText("90 or olderyo female")).toBeFalsy();
  });

  it("starts a clinician-reviewed case without extra acknowledgement", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [
        makeCase({
          source_provenance: {
            source_count: 1,
            organizations: ["American Heart Association"],
            review_status: "clinician_reviewed",
            review_label: "Clinician reviewed",
            requires_caution: false,
            last_reviewed_at: "2026-06-02",
            review_valid_until: "2027-06-02",
            review_stale: false,
            review_date_invalid: false,
            review_content_changed: false,
          },
        }),
      ],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockCreateSession.mockResolvedValue({ id: "session-reviewed" });

    render(<CasesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));

    await waitFor(() => expect(mockCreateSession).toHaveBeenCalledWith("case-1", {
      acknowledge_unreviewed_case: false,
    }));
    expect(screen.queryByText(/not clinician reviewed/i)).toBeFalsy();
    expect(mockPush).toHaveBeenCalledWith("/sessions/session-reviewed");
  });

  it("highlights AI-generated unreviewed cases", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [
        makeCase({
          source_provenance: {
            source_count: 1,
            organizations: ["American College of Physicians"],
            review_status: "ai_generated_unreviewed",
            review_label: "AI-generated, unreviewed",
            requires_caution: true,
            last_reviewed_at: null,
            review_valid_until: null,
            review_stale: false,
            review_date_invalid: false,
            review_content_changed: false,
          },
        }),
      ],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    render(<CasesPage />);

    expect(screen.getByText("AI-generated, unreviewed")).toBeTruthy();
    expect(screen.getByText("Not clinician reviewed; use only for education.")).toBeTruthy();
    expect(screen.queryByText(/Reviewed/)).toBeFalsy();
  });

  it("blocks starting a stale reviewed case until re-review", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [
        makeCase({
          source_provenance: {
            source_count: 1,
            organizations: ["American Heart Association"],
            review_status: "clinician_reviewed",
            review_label: "Clinician review stale",
            requires_caution: true,
            last_reviewed_at: "2024-01-01",
            review_valid_until: "2024-12-31",
            review_stale: true,
            review_date_invalid: false,
            review_content_changed: false,
          },
        }),
      ],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    render(<CasesPage />);

    expect(screen.getByText("Clinician review stale")).toBeTruthy();
    expect(screen.getByText("Clinician review is stale; re-review required.")).toBeTruthy();
    expect(screen.getByText("Reviewed 2024-01-01 · Valid until 2024-12-31")).toBeTruthy();
    const startButton = screen.getByRole("button", { name: "Re-review Required" });
    expect(startButton).toHaveProperty("disabled", true);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/Start only as educational simulation/)).toBeFalsy();
  });

  it("blocks starting a future-dated reviewed case until re-review", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [
        makeCase({
          source_provenance: {
            source_count: 1,
            organizations: ["American Heart Association"],
            review_status: "clinician_reviewed",
            review_label: "Clinician review date invalid",
            requires_caution: true,
            last_reviewed_at: "2099-01-01",
            review_valid_until: null,
            review_stale: false,
            review_date_invalid: true,
            review_content_changed: false,
          },
        }),
      ],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    render(<CasesPage />);

    expect(screen.getByText("Clinician review date invalid")).toBeTruthy();
    expect(screen.getByText("Clinician review date is invalid; re-review required.")).toBeTruthy();
    expect(screen.getByText("Reviewed 2099-01-01")).toBeTruthy();
    const startButton = screen.getByRole("button", { name: "Re-review Required" });
    expect(startButton).toHaveProperty("disabled", true);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/Start only as educational simulation/)).toBeFalsy();
  });

  it("blocks starting a case changed after review until re-review", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [
        makeCase({
          source_provenance: {
            source_count: 1,
            organizations: ["American Heart Association"],
            review_status: "clinician_reviewed",
            review_label: "Clinician review content changed",
            requires_caution: true,
            last_reviewed_at: "2026-06-01",
            review_valid_until: "2027-06-01",
            review_stale: false,
            review_date_invalid: false,
            review_content_changed: true,
          },
        }),
      ],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    render(<CasesPage />);

    expect(screen.getByText("Clinician review content changed")).toBeTruthy();
    expect(screen.getByText("Case changed after clinician review; re-review required.")).toBeTruthy();
    const startButton = screen.getByRole("button", { name: "Re-review Required" });
    expect(startButton).toHaveProperty("disabled", true);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/Start only as educational simulation/)).toBeFalsy();
  });

  it("generates a demo case and refreshes the list", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockGenerateDemo.mockResolvedValue(makeCase());

    render(<CasesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Your First Case" }));

    await waitFor(() => expect(mockGenerateDemo).toHaveBeenCalledOnce());
    expect(mockMutate).toHaveBeenCalledOnce();
  });

  it("updates the SWR key when a specialty filter changes", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [makeCase()],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    render(<CasesPage />);
    fireEvent.click(screen.getByRole("button", { name: "neurology" }));

    await waitFor(() => {
      expect(vi.mocked(useSWR).mock.calls.some(([key]) => (
        key === "/api/cases?specialty=neurology"
      ))).toBe(true);
    });
  });
});
