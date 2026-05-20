import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAnalytics } from "@/types";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

vi.mock("@/lib/api", () => ({
  api: {
    analytics: {
      me: vi.fn(),
    },
  },
}));

import AnalyticsPage from "@/app/analytics/page";

const makeAnalytics = (overrides: Partial<UserAnalytics> = {}): UserAnalytics => ({
  user_id: "user-1",
  total_sessions: 3,
  completed_sessions: 2,
  total_messages: 12,
  avg_reasoning_score: 74,
  bias_patterns: [
    {
      bias_type: "anchoring",
      count: 2,
      severity_distribution: { mild: 1, moderate: 1 },
      avg_confidence: 0.75,
    },
  ],
  reasoning_trend: [
    { session_number: 1, avg_score: 68, date: "2026-05-20T00:00:00Z" },
    { session_number: 2, avg_score: 80, date: "2026-05-21T00:00:00Z" },
  ],
  total_tokens_used: 1500,
  strongest_areas: ["Prioritization"],
  weakest_areas: ["Evidence integration"],
  specialty_performance: { internal_medicine: 74 },
  ...overrides,
});

beforeEach(() => {
  mockPush.mockClear();
});

describe("AnalyticsPage", () => {
  it("shows a loading spinner while analytics load", () => {
    vi.mocked(useSWR).mockReturnValue({ data: undefined, error: undefined } as ReturnType<
      typeof useSWR
    >);

    const { container } = render(<AnalyticsPage />);

    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows an error state", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: undefined,
      error: new Error("failed"),
    } as ReturnType<typeof useSWR>);

    render(<AnalyticsPage />);

    expect(screen.getByText(/Could not load analytics/)).toBeTruthy();
  });

  it("renders analytics metrics and patterns", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: makeAnalytics(),
      error: undefined,
    } as ReturnType<typeof useSWR>);

    render(<AnalyticsPage />);

    expect(screen.getByText("Reasoning Dashboard")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getAllByText("74").length).toBeGreaterThan(0);
    expect(screen.getByText("1,500")).toBeTruthy();
    expect(screen.getByText("anchoring")).toBeTruthy();
    expect(screen.getByText("Prioritization")).toBeTruthy();
    expect(screen.getByText("Evidence integration")).toBeTruthy();
  });
});
