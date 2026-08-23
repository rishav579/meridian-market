/**
 * GET /api/admin/stats — platform analytics (admin only, short-TTL cached):
 * GMV, commission earnings, order pipeline, store leaderboard, payout ledger.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi } from "@/lib/api";
import { cached } from "@/lib/cache";
import { CATEGORIES } from "@/lib/constants";

export const GET = withApi(
  { rateLimit: { limit: 60, windowMs: 60_000 }, roles: ["ADMIN"] },
  async () => {
    const stats = await cached("admin:stats", 5_000, async () => {
      const [orders, productCount, userCount, storeRows, payouts] = await Promise.all([
        db.order.findMany({
          where: { status: { not: "CANCELLED" } },
          select: { total: true, commissionTotal: true, status: true, createdAt: true },
        }),
        db.product.count(),
        db.user.count(),
        db.store.findMany({
          include: {
            _count: { select: { products: true } },
            orderItems: { where: { order: { status: { not: "CANCELLED" } } }, select: { vendorEarnings: true, lineTotal: true } },
          },
        }),
        db.payout.groupBy({ by: ["status"], _sum: { amount: true }, _count: true }),
      ]);

      const gmvCents = orders.reduce((s, o) => s + o.total, 0);
      const commissionCents = orders.reduce((s, o) => s + o.commissionTotal, 0);

      const byStatus = Object.fromEntries(
        ["PENDING", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].map((st) => [
          st,
          orders.filter((o) => o.status === st).length,
        ])
      );

      const stores = storeRows
        .map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          commissionRate: s.commissionRate,
          productCount: s._count.products,
          revenueCents: s.orderItems.reduce((sum, i) => sum + i.lineTotal, 0),
          vendorEarningsCents: s.orderItems.reduce((sum, i) => sum + i.vendorEarnings, 0),
        }))
        .sort((a, b) => b.revenueCents - a.revenueCents);

      return {
        gmvCents,
        commissionCents,
        orderCount: orders.length,
        productCount,
        userCount,
        vendorCount: storeRows.filter((s) => s.status !== "PENDING").length,
        pendingStoreCount: storeRows.filter((s) => s.status === "PENDING").length,
        byStatus,
        stores,
        payouts: payouts.map((p) => ({ status: p.status, count: p._count, amountCents: p._sum.amount ?? 0 })),
        categories: CATEGORIES,
      };
    });

    return NextResponse.json(stats);
  }
);
