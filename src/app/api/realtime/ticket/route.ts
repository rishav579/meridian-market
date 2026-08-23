/**
 * GET /api/realtime/ticket — issues a 60s HMAC ticket that the browser passes
 * to the socket.io mini-service to authorize room joins (user:/store:/admin).
 * The socket never trusts client-declared rooms.
 */

import { NextResponse } from "next/server";
import { withApi, ApiError } from "@/lib/api";
import { issueRealtimeTicket } from "@/lib/auth";

export const GET = withApi(
  { rateLimit: { limit: 30, windowMs: 60_000 }, roles: [] },
  async (_req, { user }) => {
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in required for realtime updates.");
    return NextResponse.json({ ticket: issueRealtimeTicket(user) });
  }
);
