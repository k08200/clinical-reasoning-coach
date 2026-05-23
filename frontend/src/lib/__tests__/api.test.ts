import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAccessToken = vi.fn();
const mockGetRefreshToken = vi.fn();
const mockHandleUnauthorized = vi.fn();
const mockSetAuthTokens = vi.fn();

vi.mock("@/lib/session", () => ({
  getAccessToken: () => mockGetAccessToken(),
  getRefreshToken: () => mockGetRefreshToken(),
  handleUnauthorized: () => mockHandleUnauthorized(),
  setAuthTokens: (...args: unknown[]) => mockSetAuthTokens(...args),
}));

import { api } from "@/lib/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    mockGetAccessToken.mockReset();
    mockGetRefreshToken.mockReset();
    mockHandleUnauthorized.mockReset();
    mockSetAuthTokens.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("refreshes tokens and retries the original request once", async () => {
    mockGetAccessToken.mockReturnValueOnce("expired-access").mockReturnValueOnce("fresh-access");
    mockGetRefreshToken.mockReturnValue("valid-refresh");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "Invalid or expired token" }, 401))
      .mockResolvedValueOnce(jsonResponse({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        token_type: "bearer",
      }))
      .mockResolvedValueOnce(jsonResponse([{ id: "case-1" }]));

    const result = await api.cases.list();

    expect(result).toEqual([{ id: "case-1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer expired-access");
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:8000/api/auth/refresh");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer fresh-access");
    expect(mockSetAuthTokens).toHaveBeenCalledWith({
      access_token: "fresh-access",
      refresh_token: "fresh-refresh",
      token_type: "bearer",
    });
    expect(mockHandleUnauthorized).not.toHaveBeenCalled();
  });

  it("clears the session when refresh fails", async () => {
    mockGetAccessToken.mockReturnValue("expired-access");
    mockGetRefreshToken.mockReturnValue("expired-refresh");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "Invalid or expired token" }, 401))
      .mockResolvedValueOnce(jsonResponse({ detail: "Invalid or expired token" }, 401));

    await expect(api.cases.list()).rejects.toMatchObject({
      message: "Invalid or expired token",
      status: 401,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockSetAuthTokens).not.toHaveBeenCalled();
    expect(mockHandleUnauthorized).toHaveBeenCalledOnce();
  });
});
