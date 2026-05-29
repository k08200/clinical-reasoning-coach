import { beforeEach, describe, expect, it, vi } from "vitest";
import Cookies from "js-cookie";

const mockApiLogin = vi.fn();
const mockApiMe = vi.fn();

vi.mock("js-cookie", () => ({
  default: {
    get: vi.fn(),
    remove: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({
  api: {
    auth: {
      login: (...args: unknown[]) => mockApiLogin(...args),
      me: () => mockApiMe(),
    },
  },
}));

import { isAuthenticated, login } from "@/lib/auth";

describe("auth helpers", () => {
  beforeEach(() => {
    vi.mocked(Cookies.get).mockReset();
    vi.mocked(Cookies.remove).mockReset();
    vi.mocked(Cookies.set).mockReset();
    mockApiLogin.mockReset();
    mockApiMe.mockReset();
  });

  it("treats a refresh token as an authenticated browser session", () => {
    vi.mocked(Cookies.get).mockImplementation((key) => {
      if (key === "refresh_token") return "refresh-token";
      return undefined;
    });

    expect(isAuthenticated()).toBe(true);
  });

  it("returns false when no auth tokens are stored", () => {
    vi.mocked(Cookies.get).mockReturnValue(undefined);

    expect(isAuthenticated()).toBe(false);
  });

  it("stores tokens and returns the current user on login", async () => {
    mockApiLogin.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "bearer",
    });
    mockApiMe.mockResolvedValue({
      id: "user-1",
      email: "student@test.com",
      full_name: "Test Student",
      training_level: "resident",
    });

    await expect(login("student@test.com", "securepass123")).resolves.toMatchObject({
      email: "student@test.com",
    });

    expect(Cookies.set).toHaveBeenCalledWith("access_token", "access-token", {
      expires: 1,
    });
    expect(Cookies.set).toHaveBeenCalledWith("refresh_token", "refresh-token", {
      expires: 7,
    });
  });

  it("clears tokens if the current user cannot be loaded after login", async () => {
    mockApiLogin.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "bearer",
    });
    mockApiMe.mockRejectedValue(new Error("Profile unavailable"));

    await expect(login("student@test.com", "securepass123")).rejects.toThrow(
      "Profile unavailable",
    );

    expect(Cookies.remove).toHaveBeenCalledWith("access_token");
    expect(Cookies.remove).toHaveBeenCalledWith("refresh_token");
  });
});
