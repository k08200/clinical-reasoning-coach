import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRefreshAuthTokens = vi.fn();
const mockGetAccessToken = vi.fn();
const mockHandleUnauthorized = vi.fn();

vi.mock("@/lib/api", () => ({
  API_URL: "http://localhost:8000",
  refreshAuthTokens: () => mockRefreshAuthTokens(),
}));

vi.mock("@/lib/session", () => ({
  getAccessToken: () => mockGetAccessToken(),
  handleUnauthorized: () => mockHandleUnauthorized(),
}));

import { streamMessage } from "@/lib/streaming";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function streamResponse(content: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(content));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("streamMessage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    mockRefreshAuthTokens.mockReset();
    mockGetAccessToken.mockReset();
    mockHandleUnauthorized.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("refreshes tokens and retries the stream request on an initial 401", async () => {
    mockGetAccessToken.mockReturnValueOnce("expired-access").mockReturnValueOnce("fresh-access");
    mockRefreshAuthTokens.mockResolvedValue(true);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "Invalid or expired token" }, 401))
      .mockResolvedValueOnce(streamResponse([
        'data: {"type":"text","content":"Try again"}',
        'data: {"type":"done"}',
        "",
      ].join("\n")));

    const callbacks = {
      onText: vi.fn(),
      onUsage: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };

    await streamMessage("session-1", "hello", callbacks);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer expired-access");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh-access");
    expect(mockRefreshAuthTokens).toHaveBeenCalledOnce();
    expect(callbacks.onText).toHaveBeenCalledWith("Try again");
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(mockHandleUnauthorized).not.toHaveBeenCalled();
  });
});
