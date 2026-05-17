import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CoachingSession } from "@/types";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock SWR — each test calls vi.mocked(useSWR).mockReturnValue(...)
vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

// api is not called directly in the component (SWR handles it) — no need to mock

// ── Fixtures ───────────────────────────────────────────────────────────────

const makeSession = (overrides: Partial<CoachingSession> = {}): CoachingSession => ({
  id: "session-abc",
  user_id: "user-1",
  case_id: "case-1",
  status: "completed",
  final_reasoning_score: 68,
  reasoning_map: { nodes: [], edges: [] },
  bias_summary: { anchoring: 2, premature_closure: 1 },
  total_input_tokens: 500,
  total_output_tokens: 300,
  total_thinking_tokens: 100,
  messages: [],
  started_at: "2026-05-17T07:00:00Z",
  completed_at: "2026-05-17T07:30:00Z",
  ...overrides,
});

// ── Import page AFTER mocks are set up ────────────────────────────────────

import SessionHistoryPage from "@/app/sessions/history/page";

// ── Tests ──────────────────────────────────────────────────────────────────

describe("SessionHistoryPage — loading state", () => {
  beforeEach(() => {
    vi.mocked(useSWR).mockReturnValue({ data: undefined } as ReturnType<typeof useSWR>);
  });

  it("shows spinner while loading", () => {
    const { container } = render(<SessionHistoryPage />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });
});

describe("SessionHistoryPage — empty state", () => {
  beforeEach(() => {
    vi.mocked(useSWR).mockReturnValue({ data: [] } as ReturnType<typeof useSWR>);
  });

  it("shows empty message", () => {
    render(<SessionHistoryPage />);
    expect(screen.getByText(/No sessions yet/)).toBeTruthy();
  });
});

describe("SessionHistoryPage — sessions list", () => {
  beforeEach(() => {
    vi.mocked(useSWR).mockReturnValue({
      data: [makeSession()],
    } as ReturnType<typeof useSWR>);
  });

  it("shows status badge", () => {
    render(<SessionHistoryPage />);
    expect(screen.getByText("completed")).toBeTruthy();
  });

  it("shows reasoning score", () => {
    render(<SessionHistoryPage />);
    expect(screen.getByText("68")).toBeTruthy();
  });

  it("shows top biases", () => {
    render(<SessionHistoryPage />);
    // "anchoring" is sorted first (count 2), "premature closure" second
    expect(screen.getByText(/anchoring/i)).toBeTruthy();
  });

  it("shows total tokens", () => {
    render(<SessionHistoryPage />);
    // 500 + 300 + 100 = 900
    expect(screen.getByText("900")).toBeTruthy();
  });

  it("navigates to session detail on click", () => {
    render(<SessionHistoryPage />);
    const card = screen.getByText("completed").closest("div.bg-slate-800")!;
    fireEvent.click(card);
    expect(mockPush).toHaveBeenCalledWith("/sessions/session-abc");
  });
});

describe("SessionHistoryPage — active session", () => {
  beforeEach(() => {
    vi.mocked(useSWR).mockReturnValue({
      data: [makeSession({ status: "active", final_reasoning_score: null })],
    } as ReturnType<typeof useSWR>);
  });

  it("shows dash when no score yet", () => {
    render(<SessionHistoryPage />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("shows 'active' badge", () => {
    render(<SessionHistoryPage />);
    expect(screen.getByText("active")).toBeTruthy();
  });
});

describe("SessionHistoryPage — no biases session", () => {
  beforeEach(() => {
    vi.mocked(useSWR).mockReturnValue({
      data: [makeSession({ bias_summary: {} })],
    } as ReturnType<typeof useSWR>);
  });

  it("shows None when no biases", () => {
    render(<SessionHistoryPage />);
    expect(screen.getByText("None")).toBeTruthy();
  });
});

describe("SessionHistoryPage — back navigation", () => {
  beforeEach(() => {
    vi.mocked(useSWR).mockReturnValue({ data: [] } as ReturnType<typeof useSWR>);
    mockPush.mockClear();
  });

  it("back button navigates to /cases", () => {
    render(<SessionHistoryPage />);
    fireEvent.click(screen.getByText(/Back to Cases/));
    expect(mockPush).toHaveBeenCalledWith("/cases");
  });
});
