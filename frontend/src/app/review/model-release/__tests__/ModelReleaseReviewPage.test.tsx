import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelReleaseClinicalReviewTarget, User } from "@/types";

vi.mock("@/lib/useAuthGate", () => ({
  useRequireAuth: () => false,
}));

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

const recordModelReleaseReview = vi.fn();
const mutateTarget = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    auth: { me: vi.fn() },
    governance: {
      modelReleaseReviewTarget: vi.fn(),
      recordModelReleaseReview: (...args: unknown[]) => recordModelReleaseReview(...args),
    },
  },
}));

import ModelReleaseReviewPage from "@/app/review/model-release/page";

const reviewer: User = {
  id: "reviewer-1",
  email: "reviewer@test.com",
  full_name: "Dr Reviewer",
  training_level: "fellow",
  role: "clinician_reviewer",
  reviewer_verification_status: "verified",
  reviewer_practice_scope: "Emergency medicine educational simulation",
  reviewer_credential_current: true,
  accepted_educational_use: true,
  accepted_educational_use_at: "2026-07-01T00:00:00Z",
};

const target: ModelReleaseClinicalReviewTarget = {
  provider: "ollama",
  model: "clinical-coach-v1",
  evaluation_sha256: "a".repeat(64),
  evaluation_current: true,
  evaluation_detail: "Current evaluation artifact.",
  current_reviewer_count: 1,
  required_reviewer_count: 2,
  current_reviewer_has_approved: false,
};

function mockSwr(currentUser: User = reviewer, currentTarget = target) {
  vi.mocked(useSWR).mockImplementation((key: unknown) => {
    if (key === "/api/auth/me") {
      return { data: currentUser, error: undefined } as ReturnType<typeof useSWR>;
    }
    if (key === "/api/governance/model-release-review-target") {
      return {
        data: currentTarget,
        error: undefined,
        mutate: mutateTarget,
      } as ReturnType<typeof useSWR>;
    }
    return { data: undefined, error: undefined } as ReturnType<typeof useSWR>;
  });
}

beforeEach(() => {
  vi.mocked(useSWR).mockReset();
  recordModelReleaseReview.mockReset();
  mutateTarget.mockReset();
});

describe("ModelReleaseReviewPage", () => {
  it("records a complete clinician approval for the current release", async () => {
    mockSwr();
    recordModelReleaseReview.mockResolvedValue({ id: "approval-1" });

    render(<ModelReleaseReviewPage />);

    expect(screen.getByText("ollama")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByLabelText("Practice scope")).toHaveValue(
        "Emergency medicine educational simulation",
      );
    });
    fireEvent.change(screen.getByLabelText("Practice scope"), {
      target: { value: "Emergency medicine educational simulation" },
    });
    for (const label of [
      "Output safety",
      "Socratic integrity",
      "Operational latency",
      "Educational limitation",
    ]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    fireEvent.change(screen.getByLabelText("Review notes"), {
      target: {
        value: "Reviewed safety behavior, Socratic coaching integrity, latency results, and educational-only limitations.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record clinical approval" }));

    await waitFor(() => {
      expect(recordModelReleaseReview).toHaveBeenCalledWith({
        practice_scope: "Emergency medicine educational simulation",
        output_safety_confirmed: true,
        socratic_integrity_confirmed: true,
        latency_confirmed: true,
        educational_use_only_confirmed: true,
        review_notes: "Reviewed safety behavior, Socratic coaching integrity, latency results, and educational-only limitations.",
      });
    });
    expect(mutateTarget).toHaveBeenCalled();
    expect(await screen.findByText("Model release clinical review recorded.")).toBeTruthy();
  });

  it("does not expose the approval form to non-reviewers", () => {
    mockSwr({ ...reviewer, role: "learner" });

    render(<ModelReleaseReviewPage />);

    expect(screen.getByText("Clinician reviewer role with a current credential is required.")).toBeTruthy();
    expect(screen.queryByText("Clinical attestation")).toBeFalsy();
  });
});
