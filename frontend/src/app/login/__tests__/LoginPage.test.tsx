import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockLogin = vi.fn();
vi.mock("@/lib/auth", () => ({
  login: (...args: unknown[]) => mockLogin(...args),
}));

vi.mock("@/lib/useAuthGate", () => ({
  useRedirectIfAuthenticated: () => false,
  hasCurrentEducationalUseConsent: (user: {
    accepted_educational_use?: boolean;
    educational_use_consent_current?: boolean;
  }) => user.educational_use_consent_current ?? !!user.accepted_educational_use,
}));

import LoginPage from "@/app/login/page";

beforeEach(() => {
  mockReplace.mockReset();
  mockLogin.mockReset();
});

describe("LoginPage", () => {
  it("signs in and navigates to cases", async () => {
    mockLogin.mockResolvedValue({
      id: "user-1",
      email: "student@test.com",
      full_name: "Test Student",
      training_level: "resident",
      accepted_educational_use: true,
      accepted_educational_use_at: "2026-06-02T00:00:00Z",
    });

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("you@hospital.edu"), {
      target: { value: "student@test.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "securepass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("student@test.com", "securepass123");
    });
    expect(mockReplace).toHaveBeenCalledWith("/cases");
  });

  it("sends existing users without consent to the consent page", async () => {
    mockLogin.mockResolvedValue({
      id: "user-1",
      email: "student@test.com",
      full_name: "Test Student",
      training_level: "resident",
      accepted_educational_use: false,
      accepted_educational_use_at: null,
    });

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("you@hospital.edu"), {
      target: { value: "student@test.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "securepass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("student@test.com", "securepass123");
    });
    expect(mockReplace).toHaveBeenCalledWith("/consent");
  });

  it("sends users with an outdated consent version to the consent page", async () => {
    mockLogin.mockResolvedValue({
      id: "user-1",
      email: "student@test.com",
      full_name: "Test Student",
      training_level: "resident",
      accepted_educational_use: true,
      educational_use_consent_current: false,
    });

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("you@hospital.edu"), {
      target: { value: "student@test.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "securepass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/consent");
    });
  });

  it("shows login errors", async () => {
    mockLogin.mockRejectedValue(new Error("Invalid credentials"));

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("you@hospital.edu"), {
      target: { value: "student@test.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "wrongpass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    expect(await screen.findByText("Invalid credentials")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
