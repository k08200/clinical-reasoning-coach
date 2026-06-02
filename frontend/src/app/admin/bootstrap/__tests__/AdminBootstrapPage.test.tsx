import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/types";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/useAuthGate", () => ({
  useRequireAuth: () => false,
}));

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

const mockBootstrapAdmin = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    auth: {
      me: vi.fn(),
      bootstrapAdmin: (...args: unknown[]) => mockBootstrapAdmin(...args),
    },
  },
}));

import AdminBootstrapPage from "@/app/admin/bootstrap/page";

const learner: User = {
  id: "learner-1",
  email: "learner@test.com",
  full_name: "Learner User",
  training_level: "resident",
  role: "learner",
  accepted_educational_use: true,
  accepted_educational_use_at: "2026-06-01T00:00:00Z",
};

function mockBootstrapSwr(user: User = learner) {
  vi.mocked(useSWR).mockImplementation((key: unknown) => {
    if (key === "/api/auth/me") {
      return { data: user, error: undefined } as ReturnType<typeof useSWR>;
    }
    return { data: undefined, error: undefined } as ReturnType<typeof useSWR>;
  });
}

beforeEach(() => {
  mockPush.mockReset();
  mockBootstrapAdmin.mockReset();
});

describe("AdminBootstrapPage", () => {
  it("renders the signed-in user and disables submit until a token is entered", () => {
    mockBootstrapSwr();

    render(<AdminBootstrapPage />);

    expect(screen.getByText("Admin Setup")).toBeTruthy();
    expect(screen.getByText("Learner User")).toBeTruthy();
    expect(screen.getByText("learner@test.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Complete Setup" })).toBeDisabled();
  });

  it("submits the setup token and routes to user administration", async () => {
    mockBootstrapSwr();
    mockBootstrapAdmin.mockResolvedValue({ ...learner, role: "admin" });

    render(<AdminBootstrapPage />);

    fireEvent.change(screen.getByLabelText("Setup Token"), {
      target: { value: "first-admin-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete Setup" }));

    await waitFor(() =>
      expect(mockBootstrapAdmin).toHaveBeenCalledWith({
        setup_token: "first-admin-token",
      }),
    );
    expect(mockPush).toHaveBeenCalledWith("/admin/users");
  });

  it("shows bootstrap errors", async () => {
    mockBootstrapSwr();
    mockBootstrapAdmin.mockRejectedValue(new Error("Admin user already exists"));

    render(<AdminBootstrapPage />);

    fireEvent.change(screen.getByLabelText("Setup Token"), {
      target: { value: "first-admin-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete Setup" }));

    await waitFor(() => expect(screen.getByText("Admin user already exists")).toBeTruthy());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
