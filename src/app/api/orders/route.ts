import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, ApiError } from "@/lib/api";
import { ORDER_STATUSES } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/orders — role-scoped order lists.
 *  CUSTOMER → own orders · VENDOR → orders containing their store's items ·
 *  ADMIN → everything. Vendors see items restricted to their own store.
 */
export const GET = withApi(
  { rateLimit: { limit: 60, windowMs: 60_000 } },
  async (req, { user }) => {
    const status = req.nextUrl.searchParams.get("status");
    const statusFilter =
      status && (ORDER_STATUSES as readonly string[]).includes(status) ? status : undefined;

    let where: Prisma.OrderWhereInput = {};
    if (user?.role === "CUSTOMER") {
      where = { userId: user.id, ...(statusFilter ? { status: statusFilter } : {}) };
    } else if (user?.role === "VENDOR") {
      if (!user.store) return NextResponse.json({ orders: [] });
      where = {
        items: { some: { storeId: user.store.id } },
        ...(statusFilter ? { status: statusFilter } : {}),
      };
    } else if (user?.role === "ADMIN") {
      where = statusFilter ? { status: statusFilter } : {};
    } else {
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in to view orders.");
    }

    const orders = await db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        items: user?.role === "VENDOR" ? { where: { storeId: user.store!.id } } : true,
        events: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json({ orders });
  }
);
