/**
 * withApi — composable route-handler middleware.
 *
 * Pipeline: rate-limit → same-origin/CSRF (mutations) → session → RBAC → handler,
 * with a single typed error envelope (Zod → 422, ApiError → status, else → 500).
 */

import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { rateLimit, getClientIp, sweepRateLimiter } from "@/lib/rate-limit";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { CSRF_COOKIE, type Role } from "@/lib/constants";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export interface ApiOptions {
  /** requests per window per IP */
  rateLimit?: { limit: number; windowMs: number };
  /** required roles; omit for public routes. Set to [] for "any authenticated user". */
  roles?: readonly Role[];
}

type Handler<C> = (req: NextRequest, ctx: C & { user: SessionUser | null }) => Promise<NextResponse | Response>;

export function withApi<C = unknown>(opts: ApiOptions, handler: Handler<C>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      // 1. Rate limiting (per IP + path bucket)
      if (opts.rateLimit) {
        const key = `${getClientIp(req)}:${req.nextUrl.pathname}:${req.method}`;
        const result = rateLimit(key, opts.rateLimit.limit, opts.rateLimit.windowMs);
        if (!result.allowed) {
          return NextResponse.json(
            { error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
            {
              status: 429,
              headers: {
                "Retry-After": String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
                "X-RateLimit-Limit": String(result.limit),
                "X-RateLimit-Reset": String(result.resetAt),
              },
            }
          );
        }
        sweepRateLimiter();
      }

      // 2. CSRF defense for state-changing verbs: strict same-origin check.
      //    (Session cookie is SameSite=Lax; origin check blocks cross-site POSTs
      //    even from Lax-form submissions, and blocks DNS rebinding.)
      //    Prefers X-Forwarded-Host (set by the gateway, port-preserving); the
      //    hostname fallback covers proxies that strip the port from Host.
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const origin = req.headers.get("origin");
        if (origin) {
          let originHost: string;
          let originHostname: string;
          try {
            const parsed = new URL(origin);
            originHost = parsed.host;
            originHostname = parsed.hostname;
          } catch {
            return NextResponse.json(
              { error: { code: "BAD_ORIGIN", message: "Invalid origin header." } },
              { status: 403 }
            );
          }
          const forwardedHost = req.headers.get("x-forwarded-host");
          const host = forwardedHost?.split(",")[0]?.trim() || req.headers.get("host") || "";
          const hostNoPort = host.split(":")[0] ?? "";
          if (originHost !== host && originHostname !== hostNoPort) {
            return NextResponse.json(
              { error: { code: "CSRF_REJECTED", message: "Cross-origin request rejected." } },
              { status: 403 }
            );
          }
        }
      }

      // 3. Session + RBAC
      const user = await getSessionUser();
      if (opts.roles && !user) {
        throw new ApiError(401, "UNAUTHENTICATED", "You must be signed in.");
      }
      if (opts.roles && opts.roles.length > 0 && user && !opts.roles.includes(user.role)) {
        throw new ApiError(403, "FORBIDDEN", "Your role does not permit this action.");
      }

      // 4. Handler
      const response = await handler(req, { ...ctx, user });
      return response;
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input.",
          issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 422 }
    );
  }
  if (err instanceof ApiError) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  console.error("[api] unhandled error:", err);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } },
    { status: 500 }
  );
}

/** Parse + validate a JSON body against a Zod schema (throws ZodError upward). */
export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "BAD_JSON", "Request body must be valid JSON.");
  }
  return schema.parse(raw);
}

/** Issue the double-submit CSRF token cookie on first GET (readable by JS). */
export async function ensureCsrfCookie(response: NextResponse): Promise<{ token: string; response: NextResponse }> {
  const jar = await cookies();
  let token = jar.get(CSRF_COOKIE)?.value;
  if (!token) {
    token = randomBytes(18).toString("hex");
    response.cookies.set(CSRF_COOKIE, token, {
      httpOnly: false, // double-submit: JS must echo it in x-csrf-token
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  return { token, response };
}
