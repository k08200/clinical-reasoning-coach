import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockAcceptEducationalUseConsent = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    auth: {
      acceptEducationalUseConsent: (...args: unknown[]) =>
        mockAcceptEducationalUseConsent(...args),
    },
  },
}));

vi.mock("@/lib/useAuthGate", () => ({
  useRequireAuth: () => false,
}));

import EducationalUseConsentPage from "@/app/consent/page";

beforeEach(() => {
  mockReplace.mockReset();
  mockAcceptEducationalUseConsent.mockReset();
});

describe("EducationalUseConsentPage", () => {
  it("requires confirmation before saving consent", async () => {
    mockAcceptEducationalUseConsent.mockResolvedValue({
      accepted_educational_use: true,
    });

    render(<EducationalUseConsentPage />);

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    fireEvent.click(
      screen.getByLabelText(/educational simulation, not patient care/i),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(mockAcceptEducationalUseConsent).toHaveBeenCalledWith({
        accepted_educational_use: true,
      });
    });
    expect(mockReplace).toHaveBeenCalledWith("/cases");
  });

  it("shows consent save errors", async () => {
    mockAcceptEducationalUseConsent.mockRejectedValue(new Error("Consent failed"));

    render(<EducationalUseConsentPage />);
    fireEvent.click(
      screen.getByLabelText(/educational simulation, not patient care/i),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Consent failed")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
