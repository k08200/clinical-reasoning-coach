import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClinicalCase,
  ClinicalCaseReview,
  ClinicalCaseReviewDetail,
  User,
} from "@/types";

vi.mock("@/lib/useAuthGate", () => ({
  useRequireAuth: () => false,
}));

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

const mockCompleteClinicalReview = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    auth: {
      me: vi.fn(),
    },
    cases: {
      list: vi.fn(),
      completeClinicalReview: (...args: unknown[]) => mockCompleteClinicalReview(...args),
      clinicalReviewHistory: vi.fn(),
      clinicalReviewDetail: vi.fn(),
    },
  },
}));

import ReviewPage from "@/app/review/page";

const mockMutateCases = vi.fn();
const mockMutateHistory = vi.fn();

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
  key_teaching_points: ["Risk stratification", "Serial ECGs", "Troponin trend"],
  cognitive_traps: ["anchoring", "premature closure"],
  source_provenance: {
    source_count: 1,
    organizations: ["American Heart Association"],
    review_status: "educational_draft",
    review_label: "Educational draft",
    requires_caution: true,
    last_reviewed_at: "2026-06-01",
  },
  times_used: 2,
  created_at: "2026-05-25T00:00:00Z",
  ...overrides,
});

const reviewHistory: ClinicalCaseReview[] = [
  {
    id: "review-1",
    case_id: "case-1",
    reviewer_user_id: "reviewer-1",
    prior_review_status: "educational_draft",
    resulting_review_status: "clinician_reviewed",
    confirmations: {
      clinical_accuracy_confirmed: true,
      source_alignment_confirmed: true,
      educational_safety_confirmed: true,
    },
    source_snapshot: {
      source_count: 1,
      organizations: ["American Heart Association"],
    },
    review_notes: "Reviewed against cited source.",
    created_at: "2026-06-02T00:00:00Z",
  },
];

const makeReviewDetail = (
  overrides: Partial<ClinicalCaseReviewDetail> = {},
): ClinicalCaseReviewDetail => ({
  ...makeCase(),
  diagnosis: "Sepsis from urinary source",
  clinical_red_flags: ["Hypotension", "Altered mental status"],
  time_critical_actions: ["Blood cultures", "Broad-spectrum antibiotics"],
  contraindication_checks: ["Fluid overload risk", "Drug allergy review"],
  clinical_sources: [
    {
      title: "Surviving Sepsis Campaign Guidelines",
      organization: "Society of Critical Care Medicine",
      url: "https://www.sccm.org/survivingsepsis",
      supports: ["time-critical antibiotics", "lactate-guided resuscitation"],
    },
  ],
  coach_guidance: "Probe for sepsis recognition without revealing the diagnosis.",
  reviewed_by_user_id: null,
  review_notes: null,
  ...overrides,
});

function mockReviewSwr({
  user = reviewer,
  cases = [makeCase()],
  history = reviewHistory,
  detail = makeReviewDetail(),
}: {
  user?: User;
  cases?: ClinicalCase[];
  history?: ClinicalCaseReview[];
  detail?: ClinicalCaseReviewDetail;
} = {}) {
  vi.mocked(useSWR).mockImplementation((key: unknown) => {
    if (key === "/api/auth/me") {
      return { data: user, error: undefined } as ReturnType<typeof useSWR>;
    }
    if (key === "/api/cases?review=all") {
      return {
        data: cases,
        error: undefined,
        mutate: mockMutateCases,
      } as ReturnType<typeof useSWR>;
    }
    if (typeof key === "string" && key.includes("/clinical-review/history")) {
      return {
        data: history,
        error: undefined,
        mutate: mockMutateHistory,
      } as ReturnType<typeof useSWR>;
    }
    if (typeof key === "string" && key.includes("/clinical-review/detail")) {
      return { data: detail, error: undefined } as ReturnType<typeof useSWR>;
    }
    return { data: undefined, error: undefined } as ReturnType<typeof useSWR>;
  });
}

beforeEach(() => {
  mockCompleteClinicalReview.mockReset();
  mockMutateCases.mockReset();
  mockMutateHistory.mockReset();
  mockMutateCases.mockResolvedValue(undefined);
  mockMutateHistory.mockResolvedValue(undefined);
});

describe("ReviewPage", () => {
  it("blocks learners from reviewer workflow", () => {
    mockReviewSwr({ user: learner });

    render(<ReviewPage />);

    expect(screen.getByText("Clinician reviewer role required.")).toBeTruthy();
    expect(screen.queryByText("Review Queue")).toBeFalsy();
  });

  it("renders review queue and audit history for reviewers", () => {
    mockReviewSwr();

    render(<ReviewPage />);

    expect(screen.getByText("Review Queue")).toBeTruthy();
    expect(screen.getAllByText("Chest Pain With Borderline Troponin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Educational draft").length).toBeGreaterThan(0);
    expect(screen.getByText("Sepsis from urinary source")).toBeTruthy();
    expect(screen.getByText("Hypotension")).toBeTruthy();
    expect(screen.getByText("Broad-spectrum antibiotics")).toBeTruthy();
    expect(screen.getByText("Surviving Sepsis Campaign Guidelines")).toBeTruthy();
    expect(screen.getByText("Reviewed against cited source.")).toBeTruthy();
    expect(screen.getByText("educational draft to clinician reviewed")).toBeTruthy();
  });

  it("records a clinical review after all confirmations are checked", async () => {
    mockReviewSwr();
    mockCompleteClinicalReview.mockResolvedValue(makeCase({
      source_provenance: {
        source_count: 1,
        organizations: ["American Heart Association"],
        review_status: "clinician_reviewed",
        review_label: "Clinician reviewed",
        requires_caution: false,
        last_reviewed_at: "2026-06-02",
      },
    }));

    render(<ReviewPage />);

    const submit = screen.getByRole("button", { name: "Mark Clinician Reviewed" });
    expect(submit).toBeDisabled();

    for (const checkbox of screen.getAllByRole("checkbox")) {
      fireEvent.click(checkbox);
    }
    fireEvent.change(screen.getByLabelText("Review Notes"), {
      target: { value: "Clinically appropriate for simulation." },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mockCompleteClinicalReview).toHaveBeenCalledWith("case-1", {
        clinical_accuracy_confirmed: true,
        source_alignment_confirmed: true,
        educational_safety_confirmed: true,
        review_notes: "Clinically appropriate for simulation.",
      }),
    );
    expect(mockMutateCases).toHaveBeenCalledOnce();
    expect(mockMutateHistory).toHaveBeenCalledOnce();
  });
});
