"use client";

/** Typed API client: CSRF double-submit header, normalized error envelope. */

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: Array<{ path: string; message: string }>
  ) {
    super(message);
  }
}

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)mk_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (!["GET", "HEAD"].includes(method)) headers.set("x-csrf-token", csrfToken());

  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });

  if (!res.ok) {
    let code = "HTTP_ERROR";
    let message = `Request failed (${res.status}).`;
    let issues: Array<{ path: string; message: string }> | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string; issues?: typeof issues } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      issues = body.error?.issues;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiClientError(res.status, code, message, issues);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const money = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
