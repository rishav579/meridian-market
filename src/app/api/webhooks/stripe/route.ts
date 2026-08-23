/**
 * POST /api/webhooks/stripe
 *
 * Verifies the `stripe-signature` header with timing-safe HMAC comparison and a
 * 5-minute replay window BEFORE any parsing — mirroring Stripe's
 * `constructEvent` contract. Handles `payment_intent.succeeded` (order → PAID,
 * payouts → AVAILABLE) and `transfer.created` (payout audit trail). Idempotent:
 * replaying an event never double-transitions an order.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyWebhookSignature, type WebhookEvent } from "@/lib/payments";
import { emitRealtime, roomsForOrder } from "@/lib/realtime";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text();

  // 1. Strict signature verification on the RAW body — before JSON.parse.
  const verdict = verifyWebhookSignature(raw, req.headers.get("stripe-signature"));
  if (!verdict.valid) {
    return NextResponse.json(
      { error: { code: "INVALID_SIGNATURE", message: `Webhook rejected: ${verdict.reason}` } },
      { status: 400 }
    );
  }

  // 2. Parse (body is trusted only now).
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: { code: "BAD_PAYLOAD", message: "Invalid JSON." } }, { status: 400 });
  }

  // 3. Idempotent event handling.
  if (event.type === "payment_intent.succeeded") {
    const intentId = (event.data.object as { id?: string }).id;
    const orderId = (event.data.object as { metadata?: { orderId?: string } }).metadata?.orderId;
    if (!intentId || !orderId) {
      return NextResponse.json({ received: true, ignored: "missing intent/order reference" });
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: { select: { storeId: true } } },
    });
    if (!order) return NextResponse.json({ received: true, ignored: "unknown order" });

    if (order.status === "PENDING") {
      const updated = await db.order.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          events: {
            create: { status: "PAID", message: `Payment ${intentId} confirmed. Funds split across vendors.` },
          },
        },
      });
      await db.payout.updateMany({ where: { orderId: order.id }, data: { status: "AVAILABLE" } });

      await emitRealtime({
        event: "order:new",
        rooms: roomsForOrder({ userId: updated.userId, storeIds: order.items.map((i) => i.storeId) }),
        payload: {
          orderId: updated.id,
          orderNumber: updated.orderNumber,
          status: updated.status,
          total: updated.total,
          commissionTotal: updated.commissionTotal,
          itemCount: order.items.length,
          customerName: updated.customerName,
          paidAt: new Date().toISOString(),
        },
      }).catch(() => undefined);
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === "transfer.created") {
    const transferId = (event.data.object as { id?: string }).id;
    if (transferId) {
      await db.payout.updateMany({ where: { transferId }, data: { status: "AVAILABLE" } });
    }
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true, ignored: `unhandled event ${event.type}` });
}
