import { createContext, useContext } from "react";

export type User = { id: string; username: string; role: "admin" | "user"; provider: "local" | "oidc" | "proxy"; disabled: boolean; mfaEnabled?: boolean };
export type Session = { mode: "single-user" | "server"; user: User | null; oidc: boolean; plugins?: boolean; proxy?: boolean };
export const AuthContext = createContext<Session>({ mode: "single-user", user: null, oidc: false });
export function useAuth() { return useContext(AuthContext); }

export async function authRequest<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, body === undefined ? undefined : {
    method, headers: { "Content-Type": "application/json", "X-Astronomer-Lite": "1" }, body: JSON.stringify(body)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export async function logout() {
  await authRequest("logout", {});
  sessionStorage.removeItem("astronomer-lite-activities");
  window.location.assign("/");
}
