/**
 * GET  /api/orders/:id — scoped read (customer owner / vendor participant / admin).
 * PATCH /api/orders/:id — status transitions enforced by the ORDER_TRANSITIONS
 *   state machine + role authorship rules; cancellations restock inventory and
 *   reverse pending payouts. Every transition appends an OrderEvent and pushes
 *   a realtime `order:status` event.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, parseBody, ApiError } from "@/lib/api";
import { orderStatusPatchSchema } from "@/lib/validation";
import { ORDER_TRANSITIONS, TRANSITION_AUTHORS, type OrderStatus } from "@/lib/constants";
import { emitRealtime, roomsForOrder } from "@/lib/realtime";
import type { SessionUser } from "@/lib/auth";

interface Ctx {
  params: Promise<{ id: string }>;
  user?: SessionUser | null;
}

async function loadOrder(id: string) {
  return db.order.findUnique({
    where: { id },
    include: { items: { include: { store: { select: { vendorId: true } } } }, events: { orderBy: { createdAt: "asc" } } },
  });
}

export const GET = withApi<Ctx>(
  { rateLimit: { limit: 60, windowMs: 60_000 } },
  async (_req, { params, user }) => {
    const { id } = await params;
    const order = await loadOrder(id);
    if (!order) throw new ApiError(404, "NOT_FOUND", "Order not found.");

    const isOwner = order.userId !== null && order.userId === user?.id;
    const isVendorParticipant = user?.role === "VENDOR" && order.items.some((i) => i.store.vendorId === user.id);
    const isAdmin = user?.role === "ADMIN";
    if (!isOwner && !isVendorParticipant && !isAdmin) {
      throw new ApiError(403, "FORBIDDEN", "You cannot view this order.");
    }

    const scopedItems =
      user?.role === "VENDOR" && !isAdmin
        ? order.items
            .filter((i) => i.store.vendorId === user.id)
            .map(({ store: _store, ...rest }) => rest)
        : order.items.map(({ store: _store, ...rest }) => rest);

    return NextResponse.json({ order: { ...order, items: scopedItems } });
  }
);

export const PATCH = withApi<Ctx>(
  { rateLimit: { limit: 60, windowMs: 60_000 }, roles: [] },
  async (req, { params, user }) => {
    const { id } = await params;
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in required.");

    const input = await parseBody(req, orderStatusPatchSchema);
    const order = await db.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new ApiError(404, "NOT_FOUND", "Order not found.");

    const isOwner = order.userId === user.id;
    const isVendorParticipant = user.role === "VENDOR" && order.items.some((i) => i.storeId === user.store?.id);
    const isAdmin = user.role === "ADMIN";
    if (!isOwner && !isVendorParticipant && !isAdmin) {
      throw new ApiError(403, "FORBIDDEN", "You cannot modify this order.");
    }

    // State machine guard
    const from = order.status as OrderStatus;
    const to = input.status;
    if (!ORDER_TRANSITIONS[from].includes(to)) {
      throw new ApiError(409, "INVALID_TRANSITION", `Cannot move order from ${from} to ${to}.`);
    }

    // Role authorship (PAID is webhook-only)
    if (to === "PAID") {
      throw new ApiError(403, "FORBIDDEN", "PAID status can only be set by the payment webhook.");
    }

    const authors = TRANSITION_AUTHORS[to] ?? [];
    const roleAllowed = authors.includes(user.role);
    const vendorMayAct = isVendorParticipant && authors.includes("VENDOR");
    const customerMayAct = isOwner && authors.includes("CUSTOMER") && (from === "PENDING" || from === "PAID");
    if (!(roleAllowed || vendorMayAct || customerMayAct)) {
      throw new ApiError(403, "FORBIDDEN", `Only ${(authors.join("/") || "system")} can set status ${to}.`);
    }
    if (to === "CANCELLED" && user.role === "CUSTOMER" && !(from === "PENDING" || from === "PAID")) {
      throw new ApiError(409, "TOO_LATE_TO_CANCEL", "This order can no longer be cancelled online.");
    }

    const messages: Record<OrderStatus, string> = {
      PENDING: "Order placed.",
      PAID: "Payment confirmed.",
      PROCESSING: "Vendor is preparing your order.",
      SHIPPED: "Order handed to the carrier.",
      DELIVERED: "Order delivered. Enjoy!",
      CANCELLED: "Order cancelled. Inventory restocked and payment reversed.",
    };

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.order.update({
        where: { id: order.id },
        data: { status: to, events: { create: { status: to, message: messages[to] } } },
      });

      if (to === "CANCELLED") {
        for (const item of order.items) {
          if (item.productId) {
            await tx.product.update({
              where: { id: item.productId },
              data: { stock: { increment: item.quantity } },
            });
          }
        }
        await tx.payout.updateMany({ where: { orderId: order.id, status: { in: ["PENDING", "AVAILABLE"] } }, data: { status: "REVERSED" } });
      }
      return result;
    });

    await emitRealtime({
      event: "order:status",
      rooms: roomsForOrder({ userId: order.userId, storeIds: [...new Set(order.items.map((i) => i.storeId))] }),
      payload: {
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        from,
        to,
        message: messages[to],
        total: updated.total,
        at: new Date().toISOString(),
      },
    }).catch(() => undefined);

    const fresh = await loadOrder(updated.id);
    return NextResponse.json({ order: fresh });
  }
);
