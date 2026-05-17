"use client";

import Cookies from "js-cookie";
import { api } from "./api";
import type { User, TokenResponse } from "@/types";

export function setTokens(tokens: TokenResponse): void {
  Cookies.set("access_token", tokens.access_token, { expires: 1 });
  Cookies.set("refresh_token", tokens.refresh_token, { expires: 7 });
}

export function clearTokens(): void {
  Cookies.remove("access_token");
  Cookies.remove("refresh_token");
}

export function getAccessToken(): string | undefined {
  return Cookies.get("access_token");
}

export async function login(email: string, password: string): Promise<User> {
  const tokens = (await api.auth.login(email, password)) as TokenResponse;
  setTokens(tokens);
  return api.auth.me() as Promise<User>;
}

export function logout(): void {
  clearTokens();
  window.location.href = "/login";
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}
