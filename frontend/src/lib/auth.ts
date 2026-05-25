"use client";

import { api } from "./api";
import {
  clearAuthTokens,
  getAccessToken,
  getRefreshToken,
  setAuthTokens,
} from "./session";
import type { User, TokenResponse } from "@/types";

export function setTokens(tokens: TokenResponse): void {
  setAuthTokens(tokens);
}

export function clearTokens(): void {
  clearAuthTokens();
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
  return hasStoredAuthToken();
}

export function hasStoredAuthToken(): boolean {
  return !!(getAccessToken() || getRefreshToken());
}
