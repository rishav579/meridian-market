import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { destroySession } from "@/lib/auth";

export const POST = withApi(
  { rateLimit: { limit: 20, windowMs: 60_000 } },
  async () => {
    await destroySession();
    return NextResponse.json({ ok: true });
  }
);
