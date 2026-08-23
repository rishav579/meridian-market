/**
 * In-memory sliding-window rate limiter (per IP + bucket).
 * Swap point for Redis INCR/EXPIRE in a multi-instance deployment.
 */

import { NextRequest } from "next/server";

interface WindowState {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowState>();

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const state = windows.get(key);

  if (!state || state.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, limit, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (state.count >= limit) {
    return { allowed: false, limit, remaining: 0, resetAt: state.resetAt };
  }

  state.count += 1;
  return { allowed: true, limit, remaining: limit - state.count, resetAt: state.resetAt };
}

/** Opportunistic cleanup so the map never grows unbounded. */
export function sweepRateLimiter(): void {
  const now = Date.now();
  for (const [key, state] of windows) {
    if (state.resetAt <= now) windows.delete(key);
  }
}

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "127.0.0.1";
}
