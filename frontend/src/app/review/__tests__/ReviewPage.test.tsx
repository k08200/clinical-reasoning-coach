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
  source_provenance: {
    source_count: 2,
    organizations: [
      "Society of Critical Care Medicine",
      "National Institute for Health and Care Excellence",
    ],
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
      alignment_checklist: {
        teaching_points_supported: true,
        red_flags_supported: true,
        time_critical_actions_supported: true,
        contraindication_checks_supported: true,
      },
      supported_elements: [
        {
          title: "Surviving Sepsis Campaign Guidelines",
          organization: "Society of Critical Care Medicine",
          supports: [
            "sepsis diagnosis and risk stratification",
            "hypotension and altered mental status as red flags",
            "time-critical blood cultures and broad-spectrum antibiotics",
            "fluid overload risk and drug allergy safety checks before treatment",
          ],
        },
      ],
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
  key_teaching_points: ["Risk stratification", "Serial ECGs", "Troponin trend"],
  cognitive_traps: ["anchoring", "premature closure"],
  clinical_red_flags: ["Hypotension", "Altered mental status"],
  time_critical_actions: [
    "Blood cultures",
    "Broad-spectrum antibiotics",
    "Fluid resuscitation with lactate reassessment and vasopressor escalation if hypotension persists",
  ],
  contraindication_checks: [
    "Fluid overload risk",
    "Drug allergy review",
    "Renal function and dosing review before broad-spectrum antibiotics",
    "Pregnancy status before antibiotic or imaging decisions",
  ],
  clinical_sources: [
    {
      title: "Surviving Sepsis Campaign Guidelines",
      organization: "Society of Critical Care Medicine",
      url: "https://www.sccm.org/survivingsepsis",
      supports: [
        "sepsis diagnosis and risk stratification",
        "hypotension and altered mental status as red flags",
        "time-critical blood cultures and broad-spectrum antibiotics",
        "fluid resuscitation, lactate reassessment, and vasopressor escalation if hypotension persists",
        "fluid overload risk and drug allergy safety checks before treatment",
        "renal function and dosing review before broad-spectrum antibiotics",
        "pregnancy status before antibiotic or imaging decisions",
      ],
    },
    {
      title: "NICE Sepsis Guidance",
      organization: "National Institute for Health and Care Excellence",
      url: "https://www.nice.org.uk/guidance/ng51",
      supports: [
        "sepsis diagnosis and risk stratification",
        "hypotension and altered mental status as red flags",
        "time-critical blood cultures and broad-spectrum antibiotics",
        "fluid resuscitation, lactate reassessment, and vasopressor escalation if hypotension persists",
        "fluid overload risk and drug allergy safety checks before treatment",
        "renal function and dosing review before broad-spectrum antibiotics",
        "pregnancy status before antibiotic or imaging decisions",
      ],
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
  window.history.pushState(null, "", "/review");
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
    expect(screen.getByText("Source Alignment Evidence")).toBeTruthy();
    expect(screen.getByText("Approval Blockers")).toBeTruthy();
    expect(
      screen.getByText(
        /Quality gate clear for clinician review once checklist confirmations/,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Reviewed against cited source.")).toBeTruthy();
    expect(screen.getByText("educational draft to clinician reviewed")).toBeTruthy();
  });

  it("renders older adult age buckets without appending yo in review detail", () => {
    const olderAdultCase = {
      patient_demographics: { age: "90 or older", sex: "female" },
    };
    mockReviewSwr({
      cases: [makeCase(olderAdultCase)],
      detail: makeReviewDetail(olderAdultCase),
    });

    render(<ReviewPage />);

    expect(screen.getByText("90 or older female · Chest pain")).toBeTruthy();
    expect(screen.queryByText("90 or olderyo female · Chest pain")).toBeFalsy();
  });

  it("opens a linked case from safety event context", async () => {
    window.history.pushState(null, "", "/review?case=case-2");
    mockReviewSwr({
      cases: [
        makeCase(),
        makeCase({
          id: "case-2",
          title: "Safety Event Linked Case",
          chief_complaint: "Confusion",
        }),
      ],
      detail: makeReviewDetail({
        id: "case-2",
        title: "Safety Event Linked Case",
        diagnosis: "Sepsis from urinary source",
      }),
    });

    render(<ReviewPage />);

    await waitFor(() =>
      expect(
        vi.mocked(useSWR).mock.calls.some(
          ([key]) => key === "/api/cases/case-2/clinical-review/detail",
        ),
      ).toBe(true),
    );
    expect(screen.getAllByText("Safety Event Linked Case").length).toBeGreaterThan(0);
  });

  it("includes stale reviewed cases in the pending queue", () => {
    mockReviewSwr({
      cases: [
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
    });

    render(<ReviewPage />);

    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Clinician review stale").length).toBeGreaterThan(0);
  });

  it("includes future-dated reviewed cases in the pending queue", () => {
    mockReviewSwr({
      cases: [
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
    });

    render(<ReviewPage />);

    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Clinician review date invalid").length).toBeGreaterThan(0);
  });

  it("includes cases changed after review in the pending queue", () => {
    mockReviewSwr({
      cases: [
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
    });

    render(<ReviewPage />);

    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Clinician review content changed").length).toBeGreaterThan(0);
  });

  it("records a clinical review after all confirmations are checked", async () => {
    mockReviewSwr();
    mockCompleteClinicalReview.mockResolvedValue(makeCase({
      source_provenance: {
        source_count: 2,
        organizations: [
          "Society of Critical Care Medicine",
          "National Institute for Health and Care Excellence",
        ],
        review_status: "clinician_reviewed",
        review_label: "Clinician reviewed",
        requires_caution: false,
        last_reviewed_at: "2026-06-02",
        review_valid_until: "2027-06-02",
        review_stale: false,
        review_date_invalid: false,
        review_content_changed: false,
      },
    }));

    render(<ReviewPage />);

    const submit = screen.getByRole("button", { name: "Mark Clinician Reviewed" });
    expect(submit).toBeDisabled();

    for (const checkbox of screen.getAllByRole("checkbox")) {
      fireEvent.click(checkbox);
    }
    fireEvent.change(screen.getByLabelText("Review Notes"), {
      target: {
        value: "Source alignment, safety checks, and educational simulation limitations reviewed.",
      },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mockCompleteClinicalReview).toHaveBeenCalledWith("case-1", {
        clinical_accuracy_confirmed: true,
        source_alignment_confirmed: true,
        source_alignment_checks: {
          teaching_points_supported: true,
          red_flags_supported: true,
          time_critical_actions_supported: true,
          contraindication_checks_supported: true,
        },
        educational_safety_confirmed: true,
        review_notes:
          "Source alignment, safety checks, and educational simulation limitations reviewed.",
      }),
    );
    expect(mockMutateCases).toHaveBeenCalledOnce();
    expect(mockMutateHistory).toHaveBeenCalledOnce();
  });

  it("requires source alignment checks before review submission", () => {
    mockReviewSwr();

    render(<ReviewPage />);

    fireEvent.click(
      screen.getByLabelText("Diagnosis, findings, and teaching points are clinically accurate."),
    );
    fireEvent.click(
      screen.getByLabelText(
        "Cited sources support all checked educational and safety content areas.",
      ),
    );
    fireEvent.click(
      screen.getByLabelText("Case is appropriate for simulation, not patient care."),
    );

    expect(screen.getByRole("button", { name: "Mark Clinician Reviewed" })).toBeDisabled();
    expect(mockCompleteClinicalReview).not.toHaveBeenCalled();
  });

  it("requires audit review notes before review submission", () => {
    mockReviewSwr();

    render(<ReviewPage />);

    for (const checkbox of screen.getAllByRole("checkbox")) {
      fireEvent.click(checkbox);
    }

    expect(screen.getByText(/Add at least 30 characters and mention source alignment/)).toBeTruthy();
    expect(screen.getByText(/Summarize source alignment, safety checks/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark Clinician Reviewed" })).toBeDisabled();
    expect(mockCompleteClinicalReview).not.toHaveBeenCalled();
  });

  it("requires review notes to cover source, safety, and educational domains", () => {
    mockReviewSwr();

    render(<ReviewPage />);

    for (const checkbox of screen.getAllByRole("checkbox")) {
      fireEvent.click(checkbox);
    }
    fireEvent.change(screen.getByLabelText("Review Notes"), {
      target: { value: "Reviewed carefully by clinician reviewer before approval." },
    });

    expect(screen.getByText(/mention source alignment, safety checks/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark Clinician Reviewed" })).toBeDisabled();
    expect(mockCompleteClinicalReview).not.toHaveBeenCalled();
  });

  it("blocks clinical review submission when safety metadata is incomplete", () => {
    mockReviewSwr({
      detail: makeReviewDetail({
        clinical_red_flags: [],
      }),
    });

    render(<ReviewPage />);

    for (const checkbox of screen.getAllByRole("checkbox")) {
      fireEvent.click(checkbox);
    }

    expect(screen.getByText("Quality Gate")).toBeTruthy();
    expect(screen.getByText("Approval Blockers")).toBeTruthy();
    expect(screen.getAllByText("At least 2 clinical red flags are required.").length).toBe(2);
    expect(screen.getByRole("button", { name: "Mark Clinician Reviewed" })).toBeDisabled();
    expect(mockCompleteClinicalReview).not.toHaveBeenCalled();
  });

  it("blocks clinical review submission without independent source organizations", () => {
    mockReviewSwr({
      detail: makeReviewDetail({
        clinical_sources: [
          {
            title: "Surviving Sepsis Campaign Guidelines",
            organization: "Society of Critical Care Medicine",
            url: "https://www.sccm.org/survivingsepsis",
            supports: [
              "sepsis diagnosis and risk stratification",
              "hypotension and altered mental status as red flags",
              "time-critical blood cultures and broad-spectrum antibiotics",
              "fluid overload risk and drug allergy safety checks before treatment",
              "renal function and dosing review before broad-spectrum antibiotics",
              "pregnancy status before antibiotic or imaging decisions",
            ],
          },
        ],
      }),
    });

    render(<ReviewPage />);

    for (const checkbox of screen.getAllByRole("checkbox")) {
      fireEvent.click(checkbox);
    }
    fireEvent.change(screen.getByLabelText("Review Notes"), {
      target: { value: "Sources, safety checks, and simulation limits reviewed." },
    });

    expect(screen.getByText("Independent source organizations")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(
      screen.getAllByText(
        /requires at least 2 independent clinical source organizations/i,
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Mark Clinician Reviewed" })).toBeDisabled();
    expect(mockCompleteClinicalReview).not.toHaveBeenCalled();
  });

  it("shows structured safety gate checklist for clinician review", () => {
    mockReviewSwr();

    render(<ReviewPage />);

    expect(screen.getByText("Safety Gate Checklist")).toBeTruthy();
    expect(screen.getByText("3 domain-specific gates triggered for clinician review.")).toBeTruthy();
    expect(screen.getByText("Infection cultures and treatment plan")).toBeTruthy();
    expect(screen.getByText("Infection antimicrobial safety")).toBeTruthy();
    expect(screen.getByText("Sepsis resuscitation actions")).toBeTruthy();
    expect(screen.getByText("All clear")).toBeTruthy();
  });

  it("shows missing domain safety gate details before review approval", () => {
    mockReviewSwr({
      detail: makeReviewDetail({
        contraindication_checks: ["Drug allergy review before antibiotics"],
      }),
    });

    render(<ReviewPage />);

    expect(screen.getByText("Safety Gate Checklist")).toBeTruthy();
    expect(screen.getByText("1 missing")).toBeTruthy();
    expect(screen.getByText("Infection antimicrobial safety")).toBeTruthy();
    expect(
      screen.getAllByText(
        "antimicrobial allergy and renal dosing safety checks are required for infection therapy",
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "Mark Clinician Reviewed" })).toBeDisabled();
  });

  it("blocks review submission when source domain is not reputable", () => {
    mockReviewSwr({
      detail: makeReviewDetail({
        clinical_sources: [
          {
            title: "Wellness Blog",
            organization: "Wellness Blog",
            url: "https://wellness-blog.com/sepsis",
            supports: [
              "sepsis diagnosis and risk stratification",
              "hypotension and altered mental status as red flags",
              "time-critical blood cultures and broad-spectrum antibiotics",
              "fluid overload risk and drug allergy safety checks before treatment",
            ],
          },
        ],
      }),
    });

    render(<ReviewPage />);

    for (const checkbox of screen.getAllByRole("checkbox")) {
      fireEvent.click(checkbox);
    }
    fireEvent.change(screen.getByLabelText("Review Notes"), {
      target: { value: "Sources, safety checks, and simulation limits reviewed." },
    });

    expect(
      screen.getAllByText("Clinical source 1 must use a reputable clinical source domain.")
        .length,
    ).toBe(2);
    expect(screen.getByRole("button", { name: "Mark Clinician Reviewed" })).toBeDisabled();
    expect(mockCompleteClinicalReview).not.toHaveBeenCalled();
  });

  it("blocks review submission when source supports miss safety scopes", () => {
    mockReviewSwr({
      detail: makeReviewDetail({
        clinical_sources: [
          {
            title: "Surviving Sepsis Campaign Guidelines",
            organization: "Society of Critical Care Medicine",
            url: "https://www.sccm.org/survivingsepsis",
            supports: [
              "sepsis diagnosis and risk stratification",
              "hypotension and altered mental status as red flags",
            ],
          },
        ],
      }),
    });

    render(<ReviewPage />);

    expect(
      screen.getAllByText("Clinical sources must include support for time-critical actions.")
        .length,
    ).toBe(2);
    expect(
      screen.getAllByText(
        "Clinical sources must include support for contraindication or safety checks.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Mark Clinician Reviewed" })).toBeDisabled();
  });

  it("blocks review submission when source supports do not anchor safety items", () => {
    mockReviewSwr({
      detail: makeReviewDetail({
        clinical_sources: [
          {
            title: "Surviving Sepsis Campaign Guidelines",
            organization: "Society of Critical Care Medicine",
            url: "https://www.sccm.org/survivingsepsis",
            supports: [
              "sepsis diagnosis and risk stratification",
              "shock red flags and severity markers",
              "time-critical antibiotics within 1 hour",
              "renal impairment and allergy safety checks before dosing",
            ],
          },
        ],
      }),
    });

    render(<ReviewPage />);

    expect(
      screen.getAllByText(
        "Clinical sources must specifically anchor clinical red flags: Hypotension",
      ).length,
    ).toBe(2);
    expect(
      screen.getAllByText(
        "Clinical sources must specifically anchor time-critical actions: Blood cultures",
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Mark Clinician Reviewed" })).toBeDisabled();
  });
});
