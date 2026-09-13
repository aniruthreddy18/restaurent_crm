"use client";

/**
 * Browser-side fetch wrapper for the dashboard's own API calls.
 *
 * Every mutation echoes the CSRF cookie in a header — the server rejects a
 * cookie-authenticated write without it, so a cross-site page cannot drive the
 * CRM using the user's ambient session.
 */
function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)crm_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    /** Field-level problems from a 422, so a form can point at the right input. */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const response = await fetch(path, {
    ...init,
    method,
    headers: {
      "content-type": "application/json",
      ...(method === "GET" ? {} : { "x-csrf-token": csrfToken() }),
      ...(init.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success === false) {
    const error = payload?.error;
    throw new ApiError(
      error?.message ?? `Request failed (${response.status})`,
      response.status,
      error?.code ?? "UNKNOWN",
      error?.details,
    );
  }

  return payload?.data as T;
}
