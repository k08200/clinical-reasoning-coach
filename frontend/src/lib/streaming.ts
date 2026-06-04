import { API_URL, refreshAuthTokens } from "./api";
import { getAccessToken, handleUnauthorized } from "./session";
import type { StreamEvent, TokenUsage } from "@/types";

export interface StreamCallbacks {
  onThinking?: () => void;
  onText: (text: string) => void;
  onUsage: (usage: Partial<TokenUsage>) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

function streamErrorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (
    detail &&
    typeof detail === "object" &&
    "message" in detail &&
    typeof detail.message === "string"
  ) {
    return detail.message;
  }
  return fallback;
}

export async function streamMessage(
  sessionId: string,
  content: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  let response = await openStream(sessionId, content);

  if (!response.ok && response.status === 401) {
    const didRefresh = await refreshAuthTokens();
    if (didRefresh) {
      response = await openStream(sessionId, content);
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: "Stream failed" }));
    if (response.status === 401) {
      handleUnauthorized();
    }
    callbacks.onError(streamErrorMessage(body.detail, "Failed to connect"));
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;

      try {
        const event = JSON.parse(raw) as StreamEvent;
        switch (event.type) {
          case "thinking":
            callbacks.onThinking?.();
            break;
          case "text":
            callbacks.onText(event.content);
            break;
          case "usage":
            callbacks.onUsage(event.usage);
            break;
          case "done":
            callbacks.onDone();
            return;
          case "error":
            callbacks.onError(event.message);
            return;
        }
      } catch {
        // Malformed SSE line - skip
      }
    }
  }
}

async function openStream(sessionId: string, content: string): Promise<Response> {
  const token = getAccessToken();

  return fetch(`${API_URL}/api/sessions/${sessionId}/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content }),
  });
}
