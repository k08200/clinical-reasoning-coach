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
vi.mock("@/lib/api", () => ({
  api: {
    sessions: {
      get: vi.fn(),
      complete: (...args: unknown[]) => mockComplete(...args),
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

beforeEach(() => {
  mockPush.mockClear();
  mockMutate.mockReset();
  mockMutate.mockResolvedValue(undefined);
  mockComplete.mockReset();
  mockComplete.mockResolvedValue({});
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

  it("completes the session", async () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeSession(),
      mutate: mockMutate,
    } as unknown as ReturnType<typeof useSWR>);

    render(<SessionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Finish Session" }));

    await waitFor(() => expect(mockComplete).toHaveBeenCalledWith("session-1"));
    expect(mockMutate).toHaveBeenCalled();
  });
});
