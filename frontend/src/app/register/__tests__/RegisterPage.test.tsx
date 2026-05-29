import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockRegister = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    auth: {
      register: (...args: unknown[]) => mockRegister(...args),
    },
  },
}));

const mockLogin = vi.fn();
vi.mock("@/lib/auth", () => ({
  login: (...args: unknown[]) => mockLogin(...args),
}));

vi.mock("@/lib/useAuthGate", () => ({
  useRedirectIfAuthenticated: () => false,
}));

import RegisterPage from "@/app/register/page";

beforeEach(() => {
  mockReplace.mockReset();
  mockRegister.mockReset();
  mockLogin.mockReset();
});

describe("RegisterPage", () => {
  it("creates an account, signs in, and navigates to cases", async () => {
    mockRegister.mockResolvedValue({ id: "user-1" });
    mockLogin.mockResolvedValue({
      id: "user-1",
      email: "student@test.com",
      full_name: "Test Student",
      training_level: "resident",
    });

    render(<RegisterPage />);
    fireEvent.change(screen.getByPlaceholderText("Dr. Kim"), {
      target: { value: "Test Student" },
    });
    fireEvent.change(screen.getByPlaceholderText("you@hospital.edu"), {
      target: { value: "student@test.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Min 8 characters"), {
      target: { value: "securepass123" },
    });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "resident" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        email: "student@test.com",
        password: "securepass123",
        full_name: "Test Student",
        training_level: "resident",
      });
    });
    expect(mockLogin).toHaveBeenCalledWith("student@test.com", "securepass123");
    expect(mockReplace).toHaveBeenCalledWith("/cases");
  });

  it("shows registration errors", async () => {
    mockRegister.mockRejectedValue(new Error("Email already registered"));

    render(<RegisterPage />);
    fireEvent.change(screen.getByPlaceholderText("Dr. Kim"), {
      target: { value: "Test Student" },
    });
    fireEvent.change(screen.getByPlaceholderText("you@hospital.edu"), {
      target: { value: "student@test.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Min 8 characters"), {
      target: { value: "securepass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

    expect(await screen.findByText("Email already registered")).toBeTruthy();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
