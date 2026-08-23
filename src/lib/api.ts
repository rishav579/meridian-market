/**
 * withApi — composable route-handler middleware.
 *
 * Pipeline: rate-limit → CSRF (mutations) → session → RBAC → handler,
 * with a single typed error envelope (Zod → 422, ApiError → status, else → 500).
 */

import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { cookies } from "next/headers";
import { randomBytes, timingSafeEqual } from "node:crypto";
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

      // 2. CSRF defense for state-changing verbs, in order of reliability:
      //    a) double-submit token — the mk_csrf cookie must equal the x-csrf-token
      //       header. A malicious site cannot read our cookie to forge the header,
      //       and this check survives any proxy that rewrites Host (preview
      //       iframes, multi-hop gateways, etc.).
      //    b) Fetch Metadata — browsers send Sec-Fetch-Site; only `cross-site`
      //       is rejected (same-origin/same-site/none are fine).
      //    c) Legacy Origin-vs-Host comparison, used only when neither signal
      //       exists (non-browser clients without tokens).
      //    The session cookie itself is SameSite=Lax, which already blocks
      //    cross-site cookie delivery on POST requests.
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const csrfRejected = (reason: string): NextResponse =>
          NextResponse.json(
            { error: { code: "CSRF_REJECTED", message: "Cross-origin request rejected." } },
            { status: 403, headers: { "X-CSRF-Reason": reason } }
          );

        const jar = await cookies();
        const cookieToken = jar.get(CSRF_COOKIE)?.value;
        const headerToken = req.headers.get("x-csrf-token");

        if (cookieToken !== undefined || headerToken !== null) {
          const a = Buffer.from(cookieToken ?? "");
          const b = Buffer.from(headerToken ?? "");
          const tokensMatch = a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
          if (!tokensMatch) {
            return csrfRejected("token_mismatch");
          }
        } else {
          const fetchSite = req.headers.get("sec-fetch-site");
          if (fetchSite === "cross-site") {
            return csrfRejected("cross_site_fetch");
          }
          if (fetchSite === null) {
            // No token, no fetch metadata: fall back to the origin comparison.
            const origin = req.headers.get("origin");
            if (origin) {
              let originHost = "";
              let originHostname = "";
              try {
                const parsed = new URL(origin);
                originHost = parsed.host;
                originHostname = parsed.hostname;
              } catch {
                return csrfRejected("bad_origin");
              }
              const forwardedHost = req.headers.get("x-forwarded-host");
              const host = forwardedHost?.split(",")[0]?.trim() || req.headers.get("host") || "";
              const hostNoPort = host.split(":")[0] ?? "";
              if (originHost !== host && originHostname !== hostNoPort) {
                return csrfRejected("origin_mismatch");
              }
            }
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
