import { auth } from "@/lib/firebase";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/** fetch() against the Express server, attaching the current user's Firebase ID token
 *  as a Bearer header when one is available. Every server route that reads req.user
 *  (requireAdmin / requireClientOrAdminOwnership / requireClientOwnsGA4Property) needs this. */
export async function fetchWithAuth(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

/** Parses a fetchWithAuth() response as JSON, throwing an Error with the
 *  server's { error: "message" } body (or a fallback) when the response isn't ok. */
export async function readJsonOrThrow<T>(resp: Response, fallbackMessage: string): Promise<T> {
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? fallbackMessage);
  }
  return resp.json();
}
