import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/types";

vi.mock("@/lib/useAuthGate", () => ({
  useRequireAuth: () => false,
}));

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

const mockListUsers = vi.fn();
const mockUpdateUserRole = vi.fn();
const mockUpdateReviewerVerification = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    auth: {
      me: vi.fn(),
      listUsers: (...args: unknown[]) => mockListUsers(...args),
      updateUserRole: (...args: unknown[]) => mockUpdateUserRole(...args),
      updateReviewerVerification: (...args: unknown[]) =>
        mockUpdateReviewerVerification(...args),
    },
  },
}));

import AdminUsersPage from "@/app/admin/users/page";

const mockMutateUsers = vi.fn();

const admin: User = {
  id: "admin-1",
  email: "admin@test.com",
  full_name: "Admin User",
  training_level: "fellow",
  role: "admin",
  accepted_educational_use: true,
  accepted_educational_use_at: "2026-06-01T00:00:00Z",
};

const learner: User = {
  id: "learner-1",
  email: "learner@test.com",
  full_name: "Learner User",
  training_level: "resident",
  role: "learner",
  accepted_educational_use: true,
  accepted_educational_use_at: "2026-06-01T00:00:00Z",
};

const pendingReviewer: User = {
  id: "reviewer-1",
  email: "reviewer@test.com",
  full_name: "Reviewer User",
  training_level: "fellow",
  role: "clinician_reviewer",
  reviewer_verification_status: "pending",
  reviewer_practice_scope: null,
  reviewer_verified_at: null,
  reviewer_verified_by_user_id: null,
  accepted_educational_use: true,
  accepted_educational_use_at: "2026-06-01T00:00:00Z",
};

function mockAdminSwr({
  currentUser = admin,
  users = [admin, learner],
}: {
  currentUser?: User;
  users?: User[];
} = {}) {
  vi.mocked(useSWR).mockImplementation((key: unknown) => {
    if (key === "/api/auth/me") {
      return { data: currentUser, error: undefined } as ReturnType<typeof useSWR>;
    }
    if (key === "/api/auth/users") {
      return {
        data: users,
        error: undefined,
        mutate: mockMutateUsers,
      } as ReturnType<typeof useSWR>;
    }
    return { data: undefined, error: undefined } as ReturnType<typeof useSWR>;
  });
}

beforeEach(() => {
  mockListUsers.mockReset();
  mockUpdateUserRole.mockReset();
  mockUpdateReviewerVerification.mockReset();
  mockMutateUsers.mockReset();
  mockMutateUsers.mockResolvedValue(undefined);
});

describe("AdminUsersPage", () => {
  it("blocks non-admin users", () => {
    mockAdminSwr({ currentUser: learner });

    render(<AdminUsersPage />);

    expect(screen.getByText("Admin role required.")).toBeTruthy();
    expect(screen.queryByText("Total Users")).toBeFalsy();
  });

  it("shows user role counts and users for admins", () => {
    mockAdminSwr();

    render(<AdminUsersPage />);

    expect(screen.getByText("Total Users")).toBeTruthy();
    expect(screen.getByText("Reviewers")).toBeTruthy();
    expect(screen.getAllByText("Admin User").length).toBeGreaterThan(0);
    expect(screen.getByText("learner@test.com")).toBeTruthy();
  });

  it("updates a learner to clinician reviewer", async () => {
    mockAdminSwr();
    mockUpdateUserRole.mockResolvedValue({ ...learner, role: "clinician_reviewer" });

    render(<AdminUsersPage />);

    fireEvent.change(screen.getByLabelText("Role for Learner User"), {
      target: { value: "clinician_reviewer" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]);

    await waitFor(() =>
      expect(mockUpdateUserRole).toHaveBeenCalledWith("learner-1", {
        role: "clinician_reviewer",
      }),
    );
    expect(mockMutateUsers).toHaveBeenCalledOnce();
    expect(screen.getByText("Learner User role updated.")).toBeTruthy();
  });

  it("records reviewer credential verification with a practice scope", async () => {
    mockAdminSwr({ users: [admin, pendingReviewer] });
    mockUpdateReviewerVerification.mockResolvedValue({
      ...pendingReviewer,
      reviewer_verification_status: "verified",
    });

    render(<AdminUsersPage />);

    fireEvent.change(screen.getByLabelText("Practice scope for Reviewer User"), {
      target: { value: "Emergency medicine educational simulation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update Verification" }));

    await waitFor(() =>
      expect(mockUpdateReviewerVerification).toHaveBeenCalledWith("reviewer-1", {
        status: "verified",
        practice_scope: "Emergency medicine educational simulation",
      }),
    );
    expect(mockMutateUsers).toHaveBeenCalledOnce();
    expect(screen.getByText("Reviewer User reviewer verification updated.")).toBeTruthy();
  });

  it("does not allow an admin to demote themselves in the UI", () => {
    mockAdminSwr();

    render(<AdminUsersPage />);

    fireEvent.change(screen.getByLabelText("Role for Admin User"), {
      target: { value: "learner" },
    });

    expect(screen.getByText("Cannot demote yourself")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Save" })[0]).toBeDisabled();
  });
});
