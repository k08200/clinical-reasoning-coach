import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
const mockPathname = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => mockPathname(),
}));

const mockMe = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    auth: {
      me: () => mockMe(),
    },
  },
}));

const mockClearAuthTokens = vi.fn();
const mockGetAccessToken = vi.fn();
const mockGetRefreshToken = vi.fn();
vi.mock("@/lib/session", () => ({
  clearAuthTokens: () => mockClearAuthTokens(),
  getAccessToken: () => mockGetAccessToken(),
  getRefreshToken: () => mockGetRefreshToken(),
}));

import { useRedirectIfAuthenticated, useRequireAuth } from "@/lib/useAuthGate";

beforeEach(() => {
  mockReplace.mockReset();
  mockPathname.mockReset();
  mockMe.mockReset();
  mockClearAuthTokens.mockReset();
  mockGetAccessToken.mockReset();
  mockGetRefreshToken.mockReset();
  mockPathname.mockReturnValue("/cases");
});

describe("auth gate hooks", () => {
  it("sends unauthenticated users to login", () => {
    mockGetAccessToken.mockReturnValue(undefined);
    mockGetRefreshToken.mockReturnValue(undefined);

    renderHook(() => useRequireAuth());

    expect(mockReplace).toHaveBeenCalledWith("/login");
    expect(mockMe).not.toHaveBeenCalled();
  });

  it("sends authenticated users without consent to consent", async () => {
    mockGetAccessToken.mockReturnValue("access-token");
    mockGetRefreshToken.mockReturnValue(undefined);
    mockMe.mockResolvedValue({ accepted_educational_use: false });

    renderHook(() => useRequireAuth());

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/consent");
    });
  });

  it("sends users with an outdated consent version to consent", async () => {
    mockGetAccessToken.mockReturnValue("access-token");
    mockGetRefreshToken.mockReturnValue(undefined);
    mockMe.mockResolvedValue({
      accepted_educational_use: true,
      educational_use_consent_current: false,
    });

    renderHook(() => useRequireAuth());

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/consent");
    });
  });

  it("allows authenticated users with consent through", async () => {
    mockGetAccessToken.mockReturnValue("access-token");
    mockGetRefreshToken.mockReturnValue(undefined);
    mockMe.mockResolvedValue({ accepted_educational_use: true });

    const { result } = renderHook(() => useRequireAuth());

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects already authenticated users to the consent page when needed", async () => {
    mockGetAccessToken.mockReturnValue("access-token");
    mockGetRefreshToken.mockReturnValue(undefined);
    mockMe.mockResolvedValue({ accepted_educational_use: false });

    renderHook(() => useRedirectIfAuthenticated());

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/consent");
    });
  });
});
