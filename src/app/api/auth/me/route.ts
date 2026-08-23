import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, ensureCsrfCookie } from "@/lib/api";

export const GET = withApi(
  { rateLimit: { limit: 120, windowMs: 60_000 } },
  async (_req, { user }) => {
    let cartCount = 0;
    if (user) {
      const cart = await db.cart.findUnique({
        where: { userId: user.id },
        include: { _count: { select: { items: true } } },
      });
      cartCount = cart?._count.items ?? 0;
    }

    const base = NextResponse.json({ user, cartCount });
    const { response } = await ensureCsrfCookie(base);
    return response;
  }
);
