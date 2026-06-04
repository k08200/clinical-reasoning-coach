import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachingSession } from "@/types";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "session-1" }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

vi.mock("@/lib/useAuthGate", () => ({
  useRequireAuth: () => false,
}));

const mockComplete = vi.fn();
const mockReview = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    sessions: {
      get: vi.fn(),
      complete: (...args: unknown[]) => mockComplete(...args),
      review: (...args: unknown[]) => mockReview(...args),
    },
  },
}));

const mockStreamMessage = vi.fn();
vi.mock("@/lib/streaming", () => ({
  streamMessage: (...args: unknown[]) => mockStreamMessage(...args),
}));

vi.mock("@/components/ReasoningMap", () => ({
  default: ({ reasoningMap }: { reasoningMap: { nodes: unknown[] } }) => (
    <div>Reasoning Map Mock {reasoningMap.nodes.length}</div>
  ),
}));

import SessionPage from "@/app/sessions/[id]/page";

const mockMutate = vi.fn();

const makeSession = (overrides: Partial<CoachingSession> = {}): CoachingSession => ({
  id: "session-1",
  user_id: "user-1",
  case_id: "case-1",
  status: "active",
  final_reasoning_score: null,
  reasoning_map: {
    nodes: [
      {
        id: "turn_1",
        turn: 1,
        hypothesis: "ACS",
        quality: "systematic",
        supporting_evidence: ["chest pain"],
        missing_evidence: ["ECG"],
      },
    ],
    edges: [],
  },
  bias_summary: {},
  total_input_tokens: 10,
  total_output_tokens: 20,
  total_thinking_tokens: 30,
  messages: [
    {
      id: "m1",
      role: "coach",
      content: "Opening case",
      reasoning_score: null,
      biases_detected: [],
      created_at: "2026-05-20T00:00:00Z",
    },
  ],
  started_at: "2026-05-20T00:00:00Z",
  completed_at: null,
  ...overrides,
});

const analyzedStudentMessage = {
  id: "m2",
  role: "student" as const,
  content: "I am prioritizing dangerous causes and want an ECG.",
  reasoning_score: 82,
  biases_detected: [],
  created_at: "2026-05-20T00:01:00Z",
};

const secondAnalyzedStudentMessage = {
  id: "m3",
  role: "student" as const,
  content: "I would update my differential after the ECG and troponin trend.",
  reasoning_score: 84,
  biases_detected: [],
  created_at: "2026-05-20T00:02:00Z",
};

beforeEach(() => {
  mockPush.mockClear();
  mockMutate.mockReset();
  mockMutate.mockResolvedValue(undefined);
  mockComplete.mockReset();
  mockComplete.mockResolvedValue({});
  mockReview.mockReset();
  mockStreamMessage.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("SessionPage", () => {
  it("shows a loading spinner before the session loads", () => {
    vi.mocked(useSWR).mockReturnValue({ data: undefined } as ReturnType<typeof useSWR>);

    const { container } = render(<SessionPage />);

    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders the session and opens the reasoning map", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession(),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    render(<SessionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Reasoning Map" }));

    expect(screen.getByText(/Educational simulation only/)).toBeTruthy();
    expect(screen.getByText("Opening case")).toBeTruthy();
    expect(screen.getByText("Reasoning Map Mock 1")).toBeTruthy();
    expect(vi.mocked(useSWR).mock.calls.at(-1)?.[0]).toBe(null);
  });

  it("streams a learner response and refreshes the saved session", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession(),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockStreamMessage.mockImplementation(async (_id, _content, callbacks) => {
      callbacks.onUsage({ input_tokens: 5, output_tokens: 8, thinking_tokens: 3 });
      callbacks.onText("What else would you consider?");
      await callbacks.onDone();
    });

    render(<SessionPage />);
    fireEvent.change(screen.getByPlaceholderText(/Share your clinical reasoning/), {
      target: { value: "I want to consider dangerous causes first." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockStreamMessage).toHaveBeenCalledWith(
        "session-1",
        "I want to consider dangerous causes first.",
        expect.any(Object),
      );
    });
    expect(mockMutate).toHaveBeenCalled();
  });

  it("shows streamed privacy safety guidance", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession(),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockStreamMessage.mockImplementation(async (_id, _content, callbacks) => {
      callbacks.onText("I can't process or store messages that appear to contain patient identifiers.");
    });

    render(<SessionPage />);
    fireEvent.change(screen.getByPlaceholderText(/Share your clinical reasoning/), {
      target: { value: "Patient name is John Smith, DOB 01/02/1970." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/patient identifiers/)).toBeTruthy();
  });

  it("shows stream errors to the learner", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession(),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockStreamMessage.mockImplementation(async (_id, _content, callbacks) => {
      callbacks.onError("Stream failed");
    });

    render(<SessionPage />);
    fireEvent.change(screen.getByPlaceholderText(/Share your clinical reasoning/), {
      target: { value: "My reasoning" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Stream failed")).toBeTruthy();
  });

  it("disables completion until a learner response has been analyzed", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession(),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    render(<SessionPage />);

    expect(screen.getByRole("button", { name: "Finish Session" })).toBeDisabled();
    expect(
      screen.getByText("Add at least one analyzed learner response before finishing the session."),
    ).toBeTruthy();
  });

  it("requires at least two analyzed learner turns before completion", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession({
        messages: [
          {
            id: "m1",
            role: "coach",
            content: "Opening case",
            reasoning_score: null,
            biases_detected: [],
            created_at: "2026-05-20T00:00:00Z",
          },
          analyzedStudentMessage,
        ],
      }),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    render(<SessionPage />);

    expect(screen.getByRole("button", { name: "Finish Session" })).toBeDisabled();
    expect(
      screen.getByText("Complete one more analyzed reasoning turn before finishing the session."),
    ).toBeTruthy();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("completes the session after enough analyzed learner reasoning exists", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession({
        messages: [
          {
            id: "m1",
            role: "coach",
            content: "Opening case",
            reasoning_score: null,
            biases_detected: [],
            created_at: "2026-05-20T00:00:00Z",
          },
          analyzedStudentMessage,
          secondAnalyzedStudentMessage,
        ],
      }),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    render(<SessionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Finish Session" }));

    expect(screen.getByText(/Before finishing, address red flags/)).toBeTruthy();
    await waitFor(() => expect(mockComplete).toHaveBeenCalledWith("session-1"));
    expect(mockMutate).toHaveBeenCalled();
  });

  it("shows category-level safety guidance when completion is blocked", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession({
        messages: [
          {
            id: "m1",
            role: "coach",
            content: "Opening case",
            reasoning_score: null,
            biases_detected: [],
            created_at: "2026-05-20T00:00:00Z",
          },
          analyzedStudentMessage,
          secondAnalyzedStudentMessage,
        ],
      }),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockComplete.mockRejectedValueOnce({
      message: "Before finishing, address red flags in your reasoning.",
      detail: {
        code: "clinical_safety_coverage_incomplete",
        message: "Before finishing, address red flags in your reasoning.",
        covered_count: 2,
        total_count: 6,
        uncovered_categories: [
          { category: "red_flags", label: "Red flags", missing_count: 1 },
          {
            category: "time_critical_actions",
            label: "Time-critical actions",
            missing_count: 2,
          },
        ],
      },
    });

    render(<SessionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Finish Session" }));

    expect(await screen.findByText("Clinical safety reasoning still needs work")).toBeTruthy();
    expect(screen.getByText(/2 of 6 hidden safety targets are covered/)).toBeTruthy();
    expect(screen.getByText("Red flags: 1 remaining")).toBeTruthy();
    expect(screen.getByText("Time-critical actions: 2 remaining")).toBeTruthy();
    expect(screen.queryByText("Aortic dissection features before anticoagulation")).toBeFalsy();
    expect(screen.getByText(/checklist stays hidden/)).toBeTruthy();
  });

  it("shows reasoning quality guidance when completion score is too low", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession({
        messages: [
          {
            id: "m1",
            role: "coach",
            content: "Opening case",
            reasoning_score: null,
            biases_detected: [],
            created_at: "2026-05-20T00:00:00Z",
          },
          analyzedStudentMessage,
          secondAnalyzedStudentMessage,
        ],
      }),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockComplete.mockRejectedValueOnce({
      message: "Before finishing, strengthen your clinical reasoning quality.",
      detail: {
        code: "clinical_reasoning_quality_incomplete",
        message: "Before finishing, strengthen your clinical reasoning quality.",
        current_score: 52.5,
        minimum_score: 60,
      },
    });

    render(<SessionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Finish Session" }));

    expect(await screen.findByText("Clinical reasoning quality still needs work")).toBeTruthy();
    expect(screen.getByText(/Current analyzed score: 52\.5\/100/)).toBeTruthy();
    expect(screen.getByText(/Minimum to finish: 60\/100/)).toBeTruthy();
    expect(screen.getByText(/differential, supporting evidence/)).toBeTruthy();
  });

  it("shows cognitive bias guidance when completion is blocked by active severe bias", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession({
        messages: [
          {
            id: "m1",
            role: "coach",
            content: "Opening case",
            reasoning_score: null,
            biases_detected: [],
            created_at: "2026-05-20T00:00:00Z",
          },
          analyzedStudentMessage,
          secondAnalyzedStudentMessage,
        ],
      }),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockComplete.mockRejectedValueOnce({
      message: "Before finishing, revisit the severe cognitive bias.",
      detail: {
        code: "active_severe_cognitive_bias",
        message: "Before finishing, revisit the severe cognitive bias.",
        biases: [
          {
            bias_type: "premature_closure",
            label: "Premature closure",
            severity: "severe",
            confidence: 0.91,
            message_turn: 2,
          },
        ],
      },
    });

    render(<SessionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Finish Session" }));

    expect(await screen.findByText("Severe cognitive bias still needs work")).toBeTruthy();
    expect(screen.getByText(/test, disconfirm, or correct the bias/)).toBeTruthy();
    expect(screen.getByText("Premature closure: 91% confidence")).toBeTruthy();
    expect(screen.getByText(/dangerous closure, fixation, or action bias/)).toBeTruthy();
  });

  it("shows dimension-level reasoning guidance when completion dimension score is too low", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession({
        messages: [
          {
            id: "m1",
            role: "coach",
            content: "Opening case",
            reasoning_score: null,
            biases_detected: [],
            created_at: "2026-05-20T00:00:00Z",
          },
          analyzedStudentMessage,
          secondAnalyzedStudentMessage,
        ],
      }),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);
    mockComplete.mockRejectedValueOnce({
      message: "Before finishing, strengthen each core reasoning dimension.",
      detail: {
        code: "clinical_reasoning_dimension_incomplete",
        message: "Before finishing, strengthen each core reasoning dimension.",
        deficient_dimensions: [
          {
            dimension: "prioritization",
            label: "Clinical prioritization",
            current_score: 7,
            minimum_score: 12,
          },
        ],
      },
    });

    render(<SessionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Finish Session" }));

    expect(await screen.findByText("Core reasoning dimension still needs work")).toBeTruthy();
    expect(screen.getByText("Clinical prioritization: 7.0/25")).toBeTruthy();
    expect(screen.getByText(/prioritization, evidence integration/)).toBeTruthy();
  });

  it("locks the composer and completion controls for safety-locked sessions", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession({
        status: "safety_locked",
        messages: [
          {
            id: "m1",
            role: "coach",
            content: "Opening case",
            reasoning_score: null,
            biases_detected: [],
            created_at: "2026-05-20T00:00:00Z",
          },
          {
            id: "m2",
            role: "coach",
            content: "I cannot continue coaching on a real patient or emergency scenario.",
            reasoning_score: null,
            biases_detected: [],
            created_at: "2026-05-20T00:01:00Z",
          },
        ],
      }),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    render(<SessionPage />);

    expect(screen.getByText("Safety Locked")).toBeTruthy();
    expect(screen.getByText("This session has been locked for safety review.")).toBeTruthy();
    expect(screen.getByText("Message entry is disabled for this locked session.")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Share your clinical reasoning/)).toBeFalsy();
    expect(screen.queryByRole("button", { name: "Finish Session" })).toBeFalsy();
    expect(mockStreamMessage).not.toHaveBeenCalled();
  });

  it("shows the completed learning review with sources", () => {
    vi.mocked(useSWR).mockImplementation((key) => {
      if (key === "/api/sessions/session-1/review") {
        return {
          data: {
            session_id: "session-1",
            case_id: "case-1",
            educational_notice:
              "This learning review is for simulated clinical reasoning practice only. It is not patient care, medical advice, or a substitute for local clinical protocols, supervision, emergency services, or clinician judgment.",
            diagnosis_notice:
              "The diagnosis is revealed only after simulation completion for education. Do not apply it to real patients without appropriate clinical evaluation.",
            diagnosis: "Acute coronary syndrome",
            score_breakdown: {
              systematic_approach: 21,
              evidence_integration: 19,
              prioritization: 23,
              mechanism_understanding: 17,
            },
            strengths: ["Prioritized dangerous diagnoses"],
            gaps: ["Needs more disconfirming evidence"],
            coach_insights: ["Good initial safety framing."],
            bias_feedback: [
              {
                bias_type: "anchoring",
                severity: "mild",
                evidence: "Focused on ACS before explicitly considering alternatives.",
                confidence: 0.72,
                message_turn: 1,
              },
            ],
            key_teaching_points: ["Get an ECG early"],
            cognitive_traps: ["Anchoring"],
            clinical_sources: [
              {
                title: "Chest Pain Guideline",
                organization: "Cardiology Society",
                url: "https://example.org/chest-pain",
                supports: ["ECG timing"],
              },
            ],
            clinical_safety_coverage: {
              red_flags: [
                {
                  item: "Diaphoresis with crushing chest pain",
                  covered: true,
                  evidence_turns: [1],
                  evidence: [
                    {
                      turn: 1,
                      excerpt: "I prioritized diaphoresis with crushing chest pain.",
                    },
                  ],
                },
                {
                  item: "Hypoxia or hemodynamic instability",
                  covered: false,
                  evidence_turns: [],
                  evidence: [],
                },
              ],
              time_critical_actions: [
                {
                  item: "12-lead ECG within 10 minutes",
                  covered: true,
                  evidence_turns: [1],
                  evidence: [
                    {
                      turn: 1,
                      excerpt: "I would obtain an ECG within 10 minutes.",
                    },
                  ],
                },
              ],
              contraindication_checks: [
                {
                  item: "Aortic dissection features before anticoagulation",
                  covered: false,
                  evidence_turns: [],
                  evidence: [],
                },
              ],
              covered_count: 2,
              total_count: 4,
            },
            review_status: "educational_draft",
            last_reviewed_at: "2026-06-01",
          },
        } as unknown as ReturnType<typeof useSWR>;
      }

      return {
        data: makeSession({
          status: "completed",
          final_reasoning_score: 82,
          completed_at: "2026-05-20T00:10:00Z",
        }),
        mutate: mockMutate,
      } as unknown as ReturnType<typeof useSWR>;
    });

    render(<SessionPage />);

    expect(screen.getByText("Simulation Review Notice")).toBeTruthy();
    expect(screen.getByText(/simulated clinical reasoning practice only/)).toBeTruthy();
    expect(screen.getByText("Final Diagnosis (Simulation)")).toBeTruthy();
    expect(screen.getByText("Acute coronary syndrome")).toBeTruthy();
    expect(screen.getByText(/revealed only after simulation completion/)).toBeTruthy();
    expect(screen.getByText("Reasoning Breakdown")).toBeTruthy();
    expect(screen.getByText("systematic approach")).toBeTruthy();
    expect(screen.getByText(/Prioritized dangerous diagnoses/)).toBeTruthy();
    expect(screen.getByText(/Needs more disconfirming evidence/)).toBeTruthy();
    expect(screen.getByText("Good initial safety framing.")).toBeTruthy();
    expect(screen.getByText(/Focused on ACS/)).toBeTruthy();
    expect(screen.getByText(/Get an ECG early/)).toBeTruthy();
    expect(screen.getByText(/Anchoring/)).toBeTruthy();
    expect(screen.getByText("Clinical Safety Coverage")).toBeTruthy();
    expect(screen.getByText(/2 of 4 hidden safety targets addressed/)).toBeTruthy();
    expect(screen.getByText("Diaphoresis with crushing chest pain")).toBeTruthy();
    expect(
      screen.getByText("Turn 1: I prioritized diaphoresis with crushing chest pain."),
    ).toBeTruthy();
    expect(screen.getByText("Hypoxia or hemodynamic instability")).toBeTruthy();
    expect(screen.getAllByText("Covered").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missed").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Chest Pain Guideline/ })).toHaveAttribute(
      "href",
      "https://example.org/chest-pain",
    );
    expect(screen.getByText(/educational draft/)).toBeTruthy();
    expect(screen.getByText(/Reviewed 2026-06-01/)).toBeTruthy();
  });
});
