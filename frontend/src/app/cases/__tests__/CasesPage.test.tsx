import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClinicalCase, User } from "@/types";

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

const reviewer: User = {
  id: "reviewer-1",
  email: "reviewer@test.com",
  full_name: "Dr Reviewer",
  training_level: "fellow",
  role: "clinician_reviewer",
  accepted_educational_use: true,
  accepted_educational_use_at: "2026-06-01T00:00:00Z",
};

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

  it("blocks starting an unreviewed case until clinical review", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [makeCase()],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    render(<CasesPage />);

    expect(screen.getByText("1 clinical source")).toBeTruthy();
    expect(screen.getByText("Educational draft")).toBeTruthy();
    expect(screen.getByText("Not clinician reviewed; clinical review required.")).toBeTruthy();
    expect(
      screen.getByText("American Heart Association / American College of Cardiology"),
    ).toBeTruthy();
    expect(screen.getByText("Reviewed 2026-06-01 · Valid until 2027-06-01")).toBeTruthy();
    const startButton = screen.getByRole("button", { name: "Clinical Review Required" });
    expect(startButton).toHaveProperty("disabled", true);
    expect(mockCreateSession).not.toHaveBeenCalled();
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
    expect(screen.getByText("Not clinician reviewed; clinical review required.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clinical Review Required" })).toHaveProperty(
      "disabled",
      true,
    );
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

  it("shows source diversity status and reviewer shortcut for cases needing review", () => {
    vi.mocked(useSWR).mockImplementation((key: unknown) => {
      if (key === "/api/auth/me") {
        return {
          data: reviewer,
          error: undefined,
          mutate: vi.fn(),
        } as unknown as ReturnType<typeof useSWR>;
      }
      return {
        data: [
          makeCase({
            source_provenance: {
              source_count: 2,
              organizations: ["Same Clinical Society"],
              review_status: "clinician_reviewed",
              review_label: "Clinician review source diversity insufficient",
              requires_caution: true,
              last_reviewed_at: "2026-06-02",
              review_valid_until: "2027-06-02",
              review_stale: false,
              review_date_invalid: false,
              source_diversity_insufficient: true,
              review_content_changed: false,
            },
          }),
        ],
        error: undefined,
        mutate: mockMutate,
      } as unknown as ReturnType<typeof useSWR>;
    });

    render(<CasesPage />);

    expect(screen.getByText("Independent source organizations")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(
      screen.getByText("Review needs at least 2 independent clinical source organizations."),
    ).toBeTruthy();
    const reviewLink = screen.getByRole("link", { name: "Review" });
    expect(reviewLink.getAttribute("href")).toBe("/review?case=case-1");
    expect(screen.getByRole("button", { name: "Source Review Required" })).toBeDisabled();
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

  it("blocks starting a case with missing review audit until re-review", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [
        makeCase({
          source_provenance: {
            source_count: 1,
            organizations: ["American Heart Association"],
            review_status: "clinician_reviewed",
            review_label: "Clinician review audit missing",
            requires_caution: true,
            last_reviewed_at: "2026-06-01",
            review_valid_until: "2027-06-01",
            review_stale: false,
            review_date_invalid: false,
            review_audit_missing: true,
            review_content_changed: false,
          },
        }),
      ],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    render(<CasesPage />);

    expect(screen.getByText("Clinician review audit missing")).toBeTruthy();
    expect(screen.getByText("Clinical review audit is missing; re-review required.")).toBeTruthy();
    const startButton = screen.getByRole("button", { name: "Re-review Required" });
    expect(startButton).toHaveProperty("disabled", true);
    expect(mockCreateSession).not.toHaveBeenCalled();
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

  it("blocks oversized custom seed scenarios before generation", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    render(<CasesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Custom Case" }));
    fireEvent.change(screen.getByLabelText("Seed Scenario"), {
      target: { value: "a".repeat(2001) },
    });
    fireEvent.click(screen.getByLabelText("Unreviewed educational draft"));

    expect(screen.getByRole("button", { name: "Generate Custom Case" })).toBeDisabled();
    expect(screen.getByText(/2,001\/2,000 characters/)).toBeTruthy();
    expect(screen.getByText(/not pasted clinical notes/)).toBeTruthy();
    expect(mockGenerate).not.toHaveBeenCalled();
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

  it("shows structured quality gate feedback when custom generation is blocked", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockGenerate.mockRejectedValueOnce({
      message: "Generated case blocked by case quality gate",
      detail: {
        code: "generated_case_quality_gate_failed",
        message: "Generated case blocked by case quality gate",
        issues: [
          "At least 2 clinical red flags are required.",
          "Clinical source 1 must use a reputable clinical source domain.",
        ],
      },
    });

    render(<CasesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Custom Case" }));
    fireEvent.change(screen.getByLabelText("Seed Scenario"), {
      target: { value: "Simulated patient with chest pain." },
    });
    fireEvent.click(screen.getByLabelText("Unreviewed educational draft"));
    fireEvent.click(screen.getByRole("button", { name: "Generate Custom Case" }));

    expect(await screen.findByText("Case quality gate blocked generation")).toBeTruthy();
    expect(screen.getByText("Generated case blocked by case quality gate")).toBeTruthy();
    expect(screen.getByText("At least 2 clinical red flags are required.")).toBeTruthy();
    expect(
      screen.getByText("Clinical source 1 must use a reputable clinical source domain."),
    ).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("shows structured quality gate feedback when demo generation is blocked", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockGenerateDemo.mockRejectedValueOnce({
      message: "Generated case blocked by case quality gate",
      detail: {
        code: "generated_case_quality_gate_failed",
        message: "Generated case blocked by case quality gate",
        issues: ["contraindication checks are required before risky therapy."],
      },
    });

    render(<CasesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Your First Case" }));

    expect(await screen.findByText("Case quality gate blocked generation")).toBeTruthy();
    expect(
      screen.getByText("contraindication checks are required before risky therapy."),
    ).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("keeps parsing legacy quality gate strings", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: [],
      error: undefined,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockGenerateDemo.mockRejectedValueOnce({
      message:
        "Generated case blocked by case quality gate: clinical source support is required.",
      detail:
        "Generated case blocked by case quality gate: clinical source support is required.",
    });

    render(<CasesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Your First Case" }));

    expect(await screen.findByText("Case quality gate blocked generation")).toBeTruthy();
    expect(screen.getByText("clinical source support is required.")).toBeTruthy();
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
