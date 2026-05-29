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
