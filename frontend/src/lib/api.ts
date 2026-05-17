import Cookies from "js-cookie";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = Cookies.get("access_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new ApiError(body.detail || res.statusText, res.status);
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
    }) => request("/api/auth/register", { method: "POST", body: JSON.stringify(data) }),

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
    }) => request("/api/cases/generate", { method: "POST", body: JSON.stringify(data) }),
    generateDemo: () => request("/api/cases/generate/demo", { method: "POST" }),
  },

  sessions: {
    create: (case_id: string) =>
      request("/api/sessions", { method: "POST", body: JSON.stringify({ case_id }) }),
    list: () => request("/api/sessions"),
    get: (id: string) => request(`/api/sessions/${id}`),
    complete: (id: string) =>
      request(`/api/sessions/${id}/complete`, { method: "POST" }),
  },

  analytics: {
    me: () => request("/api/analytics/me"),
  },
};

export { ApiError, API_URL };
