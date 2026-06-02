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

  it("completes the session after analyzed learner reasoning exists", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Finish Session" }));

    await waitFor(() => expect(mockComplete).toHaveBeenCalledWith("session-1"));
    expect(mockMutate).toHaveBeenCalled();
  });

  it("shows the completed learning review with sources", () => {
    vi.mocked(useSWR).mockImplementation((key) => {
      if (key === "/api/sessions/session-1/review") {
        return {
          data: {
            session_id: "session-1",
            case_id: "case-1",
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
                },
                {
                  item: "Hypoxia or hemodynamic instability",
                  covered: false,
                  evidence_turns: [],
                },
              ],
              time_critical_actions: [
                {
                  item: "12-lead ECG within 10 minutes",
                  covered: true,
                  evidence_turns: [1],
                },
              ],
              contraindication_checks: [
                {
                  item: "Aortic dissection features before anticoagulation",
                  covered: false,
                  evidence_turns: [],
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

    expect(screen.getByText("Acute coronary syndrome")).toBeTruthy();
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
