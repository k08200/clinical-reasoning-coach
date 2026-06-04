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
const mockGenerate = vi.fn();
const mockCreateSession = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    cases: {
      list: vi.fn(),
      generate: (...args: unknown[]) => mockGenerate(...args),
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
  mockGenerate.mockReset();
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
      screen.getByText(
        "This case is not clinician reviewed. This is an educational simulation only, not patient care or medical advice.",
      ),
    ).toBeTruthy();
    expect(mockCreateSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge and Start" }));

    await waitFor(() => expect(mockCreateSession).toHaveBeenCalledWith("case-1", {
      acknowledge_educational_simulation: true,
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

  it("requires simulation acknowledgement before starting a clinician-reviewed case", async () => {
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

    expect(
      screen.getByText(
        "This is an educational simulation only, not patient care or medical advice. For real patients, follow local clinical protocols and contact a supervising clinician or emergency services.",
      ),
    ).toBeTruthy();
    expect(mockCreateSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge and Start" }));

    await waitFor(() => expect(mockCreateSession).toHaveBeenCalledWith("case-1", {
      acknowledge_educational_simulation: true,
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

  it("blocks starting a case without supporting clinical sources", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [
        makeCase({
          source_provenance: {
            source_count: 0,
            organizations: [],
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

    render(<CasesPage />);

    expect(screen.getByText("0 clinical sources")).toBeTruthy();
    expect(
      screen.getByText("No supporting clinical source; source review required."),
    ).toBeTruthy();
    const startButton = screen.getByRole("button", { name: "Source Review Required" });
    expect(startButton).toHaveProperty("disabled", true);
    expect(mockCreateSession).not.toHaveBeenCalled();
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

  it("generates a custom unreviewed educational draft after acknowledgement", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockGenerate.mockResolvedValue(makeCase());

    render(<CasesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Custom Case" }));
    fireEvent.change(screen.getByLabelText("Specialty"), {
      target: { value: "emergency_medicine" },
    });
    fireEvent.change(screen.getByLabelText("Difficulty"), {
      target: { value: "hard" },
    });
    fireEvent.change(screen.getByLabelText("Seed Scenario"), {
      target: { value: "Simulated elderly patient with fever and hypotension." },
    });

    expect(screen.getByRole("button", { name: "Generate Custom Case" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByLabelText("Unreviewed educational draft"));
    fireEvent.click(screen.getByRole("button", { name: "Generate Custom Case" }));

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledWith({
      specialty: "emergency_medicine",
      difficulty: "hard",
      seed_scenario: "Simulated elderly patient with fever and hypotension.",
      acknowledge_unreviewed_generation: true,
    }));
    expect(mockMutate).toHaveBeenCalledOnce();
  });

  it("shows structured PHI feedback when custom generation seed is blocked", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockGenerate.mockRejectedValueOnce({
      message: "Seed scenarios must be de-identified educational prompts.",
      detail: {
        code: "seed_scenario_contains_patient_identifiers",
        message:
          "Seed scenarios must be de-identified educational prompts. Remove patient identifiers before generating a case.",
        detected_identifier_categories: ["medical_record_number", "date_of_birth"],
      },
    });

    render(<CasesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Custom Case" }));
    fireEvent.change(screen.getByLabelText("Seed Scenario"), {
      target: { value: "Patient name is John Smith, DOB 01/02/1970, MRN A123456." },
    });
    fireEvent.click(screen.getByLabelText("Unreviewed educational draft"));
    fireEvent.click(screen.getByRole("button", { name: "Generate Custom Case" }));

    expect(await screen.findByText("Seed scenario blocked")).toBeTruthy();
    expect(screen.getByText(/Remove patient identifiers/)).toBeTruthy();
    expect(screen.getByText(/medical record number, date of birth/)).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("shows structured real-patient feedback when custom generation seed is blocked", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockGenerate.mockRejectedValueOnce({
      message: "Seed scenarios must not describe an active real patient or emergency.",
      detail: {
        code: "seed_scenario_real_patient_or_emergency",
        message:
          "Seed scenarios must not describe an active real patient or emergency. Use only clearly simulated educational prompts.",
      },
    });

    render(<CasesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Custom Case" }));
    fireEvent.change(screen.getByLabelText("Seed Scenario"), {
      target: { value: "My patient is deteriorating right now in clinic." },
    });
    fireEvent.click(screen.getByLabelText("Unreviewed educational draft"));
    fireEvent.click(screen.getByRole("button", { name: "Generate Custom Case" }));

    expect(await screen.findByText("Seed scenario blocked")).toBeTruthy();
    expect(screen.getByText(/active real patient or emergency/)).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
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
