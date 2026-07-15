import {
  getAccessToken,
  getRefreshToken,
  handleUnauthorized,
  setAuthTokens,
} from "./session";
import type {
  ReviewerCredentialEvent,
  ReviewerVerificationStatus,
  SourceAlignmentChecks,
  TokenResponse,
  UserRole,
} from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function refreshAuthTokens(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }).catch(() => null);

  if (!res?.ok) return false;

  const tokens = await res.json().catch(() => null) as TokenResponse | null;
  if (!tokens) return false;
  setAuthTokens(tokens);
  return true;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  hasRetried = false,
): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    if (res.status === 401 && !hasRetried) {
      const didRefresh = await refreshAuthTokens();
      if (didRefresh) {
        return request<T>(path, options, true);
      }
      handleUnauthorized();
    }

    const body = await res.json().catch(() => ({ detail: "Unknown error" }));
    const detail = body.detail ?? "Unknown error";
    const message =
      typeof detail === "string"
        ? detail
        : detail &&
            typeof detail === "object" &&
            "message" in detail &&
            typeof detail.message === "string"
          ? detail.message
          : res.statusText;
    throw new ApiError(message, res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  auth: {
    register: (data: {
      email: string;
      password: string;
      full_name: string;
      training_level?: string;
      accepted_educational_use: boolean;
    }) => request("/api/auth/register", { method: "POST", body: JSON.stringify(data) }),

    acceptEducationalUseConsent: (data: { accepted_educational_use: boolean }) =>
      request("/api/auth/educational-use-consent", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    login: async (email: string, password: string) => {
      const form = new URLSearchParams({ username: email, password });
      const res = await fetch(`${API_URL}/api/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(body.detail || "Login failed", res.status);
      }
      return res.json();
    },

    me: () => request("/api/auth/me"),
    bootstrapAdmin: (data: { setup_token: string }) =>
      request("/api/auth/admin/bootstrap", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    listUsers: () => request("/api/auth/users"),
    updateUserRole: (id: string, data: { role: UserRole }) =>
      request(`/api/auth/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    updateReviewerVerification: (
      id: string,
      data: {
        status: Extract<ReviewerVerificationStatus, "verified" | "suspended">;
        practice_scope?: string;
        verification_note: string;
      },
    ) =>
      request(`/api/auth/users/${id}/reviewer-verification`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    listReviewerVerificationHistory: (id: string) =>
      request(`/api/auth/users/${id}/reviewer-verification/history`) as Promise<
        ReviewerCredentialEvent[]
      >,
  },

  cases: {
    list: (params?: { specialty?: string; difficulty?: string }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request(`/api/cases${q ? `?${q}` : ""}`);
    },
    get: (id: string) => request(`/api/cases/${id}`),
    generate: (data: {
      specialty?: string;
      difficulty?: string;
      seed_scenario?: string;
      acknowledge_unreviewed_generation?: boolean;
    }) => request("/api/cases/generate", { method: "POST", body: JSON.stringify(data) }),
    generateDemo: () => request("/api/cases/generate/demo", { method: "POST" }),
    completeClinicalReview: (
      id: string,
      data: {
        clinical_accuracy_confirmed: boolean;
        source_alignment_confirmed: boolean;
        source_alignment_checks: SourceAlignmentChecks;
        educational_safety_confirmed: boolean;
        reviewer_attestation: {
          practice_scope: string;
          attests_review_within_scope: boolean;
          attests_educational_use_only: boolean;
        };
        review_notes?: string;
      },
    ) =>
      request(`/api/cases/${id}/clinical-review`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    clinicalReviewHistory: (id: string) =>
      request(`/api/cases/${id}/clinical-review/history`),
    clinicalReviewDetail: (id: string) =>
      request(`/api/cases/${id}/clinical-review/detail`),
  },

  sessions: {
    create: (
      case_id: string,
      options: {
        acknowledge_educational_simulation?: boolean;
      } = {},
    ) =>
      request("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ case_id, ...options }),
      }),
    list: () => request("/api/sessions"),
    get: (id: string) => request(`/api/sessions/${id}`),
    review: (id: string) => request(`/api/sessions/${id}/review`),
    complete: (id: string) =>
      request(`/api/sessions/${id}/complete`, { method: "POST" }),
  },

  analytics: {
    me: () => request("/api/analytics/me"),
  },

  safetyEvents: {
    list: (params?: {
      event_type?: string;
      severity?: string;
      event_status?: string;
      limit?: number;
      offset?: number;
    }) => {
      const q = new URLSearchParams();
      if (params?.event_type) q.set("event_type", params.event_type);
      if (params?.severity) q.set("severity", params.severity);
      if (params?.event_status) q.set("event_status", params.event_status);
      if (params?.limit) q.set("limit", String(params.limit));
      if (params?.offset) q.set("offset", String(params.offset));
      const query = q.toString();
      return request(`/api/safety-events${query ? `?${query}` : ""}`);
    },
    updateResolution: (
      id: string,
      data: { status: "open" | "resolved"; resolution_note?: string },
    ) =>
      request(`/api/safety-events/${id}/resolution`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
  },
};

export { ApiError, API_URL, refreshAuthTokens };
