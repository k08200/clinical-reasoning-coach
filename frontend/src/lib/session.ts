import Cookies from "js-cookie";

export function setAuthTokens(tokens: {
  access_token: string;
  refresh_token: string;
}): void {
  Cookies.set("access_token", tokens.access_token, { expires: 1 });
  Cookies.set("refresh_token", tokens.refresh_token, { expires: 7 });
}

export function clearAuthTokens(): void {
  Cookies.remove("access_token");
  Cookies.remove("refresh_token");
}

export function getAccessToken(): string | undefined {
  return Cookies.get("access_token");
}

export function getRefreshToken(): string | undefined {
  return Cookies.get("refresh_token");
}

export function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  window.location.assign("/login");
}

export function handleUnauthorized(): void {
  clearAuthTokens();
  redirectToLogin();
}
