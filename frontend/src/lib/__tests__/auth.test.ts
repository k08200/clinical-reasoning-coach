import { beforeEach, describe, expect, it, vi } from "vitest";
import Cookies from "js-cookie";
import { isAuthenticated } from "@/lib/auth";

vi.mock("js-cookie", () => ({
  default: {
    get: vi.fn(),
    remove: vi.fn(),
    set: vi.fn(),
  },
}));

describe("auth helpers", () => {
  beforeEach(() => {
    vi.mocked(Cookies.get).mockReset();
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
});
