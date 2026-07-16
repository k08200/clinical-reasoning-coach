import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernanceReadiness, User } from "@/types";

vi.mock("@/lib/useAuthGate", () => ({
  useRequireAuth: () => false,
}));

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

vi.mock("@/lib/api", () => ({
  api: {
    auth: { me: vi.fn() },
    governance: { readiness: vi.fn() },
  },
}));

import GovernanceReadinessPage from "@/app/admin/governance/page";

const admin: User = {
  id: "admin-1",
  email: "admin@test.com",
  full_name: "Admin User",
  training_level: "fellow",
  role: "admin",
  accepted_educational_use: true,
  accepted_educational_use_at: "2026-07-15T00:00:00Z",
};

const readiness: GovernanceReadiness = {
  learner_eligible_case_count: 2,
  case_blocker_count: 1,
  case_blockers: [
    {
      case_id: "case-1",
      title: "Unreviewed chest pain case",
      reasons: ["Clinician review required"],
    },
  ],
  open_safety_event_count: 3,
  open_high_risk_safety_event_count: 1,
  verified_clinician_reviewer_count: 2,
  expired_clinician_reviewer_count: 1,
  pending_clinician_reviewer_count: 1,
  suspended_clinician_reviewer_count: 0,
  consent_renewal_required_user_count: 4,
  provider_ready: true,
  provider_verification: "verified",
  provider_detail: "Configured model provider is ready.",
  model_release_approval_current: true,
  model_release_approval_detail: "Model release approval matches the configured provider and model.",
  model_release_clinical_reviewer_count: 2,
  required_model_release_clinical_reviewers: 2,
  release_ready: false,
  release_blockers: [
    {
      code: "open_high_risk_safety_events",
      count: 1,
      message: "Open high-risk safety events require operational review before learner release.",
    },
  ],
};

function mockSwr(currentUser: User = admin, data: GovernanceReadiness | undefined = readiness) {
  vi.mocked(useSWR).mockImplementation((key: unknown) => {
    if (key === "/api/auth/me") return { data: currentUser, error: undefined } as ReturnType<typeof useSWR>;
    if (key === "/api/governance/readiness") return { data, error: undefined } as ReturnType<typeof useSWR>;
    return { data: undefined, error: undefined } as ReturnType<typeof useSWR>;
  });
}

beforeEach(() => {
  vi.mocked(useSWR).mockReset();
});

describe("GovernanceReadinessPage", () => {
  it("shows release blockers and operational controls for admins", () => {
    mockSwr();

    render(<GovernanceReadinessPage />);

    expect(screen.getByText("Learner release blocked")).toBeTruthy();
    expect(screen.getByText("Unreviewed chest pain case")).toBeTruthy();
    expect(screen.getByText("Pending reviewer verification")).toBeTruthy();
    expect(screen.getByText("Expired reviewer credentials")).toBeTruthy();
    expect(screen.getByText("Consent Renewal")).toBeTruthy();
    expect(screen.getByText("Model Release")).toBeTruthy();
    expect(screen.getByText("2/2 independent clinical approvals")).toBeTruthy();
    expect(screen.getByText("Configured model provider is ready.")).toBeTruthy();
  });

  it("blocks non-admin access", () => {
    mockSwr({ ...admin, role: "learner" });

    render(<GovernanceReadinessPage />);

    expect(screen.getByText("Admin role required.")).toBeTruthy();
    expect(screen.queryByText("Governance Readiness")).toBeFalsy();
  });
});
