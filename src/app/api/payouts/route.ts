/**
 * GET /api/payouts — vendor earnings ledger (vendor: own store; admin: all).
 * Amounts are vendor-side earnings after platform commission.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, ApiError } from "@/lib/api";

export const GET = withApi(
  { rateLimit: { limit: 60, windowMs: 60_000 }, roles: ["VENDOR", "ADMIN"] },
  async (_req, { user }) => {
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in required.");

    if (user.role === "VENDOR") {
      if (!user.store) return NextResponse.json({ payouts: [] });
      const payouts = await db.payout.findMany({
        where: { storeId: user.store.id },
        include: { order: { select: { orderNumber: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return NextResponse.json({ payouts });
    }

    const payouts = await db.payout.findMany({
      include: {
        order: { select: { orderNumber: true } },
        store: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ payouts });
  }
);
