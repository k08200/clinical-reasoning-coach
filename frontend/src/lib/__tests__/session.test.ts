import { beforeEach, describe, expect, it, vi } from "vitest";
import Cookies from "js-cookie";
import {
  clearAuthTokens,
  getAccessToken,
  handleUnauthorized,
  setAuthTokens,
} from "@/lib/session";

vi.mock("js-cookie", () => ({
  default: {
    get: vi.fn(),
    remove: vi.fn(),
    set: vi.fn(),
  },
}));

describe("session helpers", () => {
  beforeEach(() => {
    vi.mocked(Cookies.get).mockReset();
    vi.mocked(Cookies.remove).mockReset();
    vi.mocked(Cookies.set).mockReset();
    window.history.pushState({}, "", "/login");
  });

  it("sets and reads auth tokens", () => {
    vi.mocked(Cookies.get).mockReturnValue("access-token");

    setAuthTokens({ access_token: "access-token", refresh_token: "refresh-token" });

    expect(Cookies.set).toHaveBeenCalledWith("access_token", "access-token", {
      expires: 1,
    });
    expect(Cookies.set).toHaveBeenCalledWith("refresh_token", "refresh-token", {
      expires: 7,
    });
    expect(getAccessToken()).toBe("access-token");
  });

  it("clears both auth tokens", () => {
    clearAuthTokens();

    expect(Cookies.remove).toHaveBeenCalledWith("access_token");
    expect(Cookies.remove).toHaveBeenCalledWith("refresh_token");
  });

  it("clears tokens for unauthorized responses", () => {
    handleUnauthorized();

    expect(Cookies.remove).toHaveBeenCalledWith("access_token");
    expect(Cookies.remove).toHaveBeenCalledWith("refresh_token");
  });
});
