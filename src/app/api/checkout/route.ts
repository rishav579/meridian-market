/**
 * POST /api/checkout
 *
 * Money flow (simulated Stripe Connect, destination-charge model):
 *  1. Lock stock validation + compute per-line commission split (store rate).
 *  2. Create Order (PENDING) + snapshotted OrderItems + OrderEvent, decrement
 *     stock — all inside one interactive transaction (atomic).
 *  3. "Capture" the PaymentIntent and issue per-store transfers (10% platform
 *     commission by default), recording Payout rows (PENDING → funds held).
 *  4. Deliver a signed `payment_intent.succeeded` webhook to OUR OWN webhook
 *     endpoint, which flips the order to PAID, payouts to AVAILABLE and pushes
 *     realtime events — proving the webhook path works exactly as in prod.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, parseBody, ApiError } from "@/lib/api";
import { checkoutSchema } from "@/lib/validation";
import { resolveCart, requireCartStock } from "@/lib/cart";
import { createPaymentIntent, captureWithSplits, buildEvent, computeSplits } from "@/lib/payments";
import { emitRealtime, roomsForOrder } from "@/lib/realtime";

const INTERNAL_BASE = process.env.INTERNAL_API_BASE ?? "http://127.0.0.1:3000";

export const POST = withApi(
  { rateLimit: { limit: 8, windowMs: 60_000 } },
  async (req, { user }) => {
    const input = await parseBody(req, checkoutSchema);
    const cartId = await resolveCart(user);

    const cart = await db.cart.findUnique({
      where: { id: cartId },
      include: { items: { include: { product: { include: { store: true } } } } },
    });
    if (!cart || cart.items.length === 0) {
      throw new ApiError(409, "EMPTY_CART", "Your cart is empty.");
    }
    await requireCartStock(cartId);

    // Group quantities per product for the split computation
    const splitInput = cart.items.map((item) => ({
      storeId: item.product!.storeId,
      storeName: item.product!.store.name,
      unitPriceCents: item.product!.priceCents,
      quantity: item.quantity,
      commissionRate: item.product!.store.commissionRate,
    }));
    const preview = computeSplits(splitInput);

    const intent = createPaymentIntent(preview.subtotal);

    // Atomic order creation
    const order = await db.$transaction(async (tx) => {
      const count = await tx.order.count();
      const orderNumber = `MK-${new Date().getFullYear()}-${String(count + 1).padStart(6, "0")}`;

      const created = await tx.order.create({
        data: {
          orderNumber,
          userId: user?.id ?? null,
          guestEmail: user ? null : input.email,
          customerName: input.shippingName,
          status: "PENDING",
          subtotal: preview.subtotal,
          commissionTotal: preview.commissionTotal,
          shippingFee: 0,
          total: preview.subtotal,
          paymentIntentId: intent.id,
          shippingName: input.shippingName,
          shippingLine1: input.line1,
          shippingCity: input.city,
          shippingState: input.state || null,
          shippingPostal: input.postal,
          shippingCountry: input.country,
          events: { create: { status: "PENDING", message: "Order placed. Awaiting payment confirmation." } },
        },
      });

      // preview.lines[i] corresponds 1:1 with splitInput[i]/cart.items[i]
      for (const [index, item] of cart.items.entries()) {
        const product = item.product!;
        const computed = preview.lines[index];

        await tx.orderItem.create({
          data: {
            orderId: created.id,
            productId: product.id,
            storeId: product.storeId,
            productName: product.name,
            storeName: product.store.name,
            imageUrl: product.imageUrl,
            unitPrice: product.priceCents,
            quantity: item.quantity,
            lineTotal: product.priceCents * item.quantity,
            commissionRate: product.store.commissionRate,
            commission: computed.commission,
            vendorEarnings: computed.vendorEarnings,
          },
        });

        await tx.product.update({
          where: { id: product.id },
          data: { stock: { decrement: item.quantity } },
        });
      }

      await tx.cartItem.deleteMany({ where: { cartId } });
      return created;
    });

    // Payment capture + Connect transfers (simulated)
    const { split } = captureWithSplits(intent.id, splitInput);

    await db.payout.createMany({
      data: split.lines.map((line) => ({
        storeId: line.storeId,
        orderId: order.id,
        amount: line.vendorEarnings,
        status: "PENDING",
        transferId: line.transferId,
      })),
    });

    // Deliver signed webhook to our own endpoint (payment settles order)
    let webhookDelivered = false;
    try {
      const { payload, signature } = buildEvent("payment_intent.succeeded", {
        id: intent.id,
        amount: split.subtotal,
        currency: "usd",
        metadata: { orderId: order.id },
      });
      const res = await fetch(`${INTERNAL_BASE}/api/webhooks/stripe`, {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        body: payload,
        signal: AbortSignal.timeout(4000),
      });
      webhookDelivered = res.ok;
    } catch {
      webhookDelivered = false;
    }

    // Safety net: if the internal webhook delivery failed, settle directly so
    // the customer experience never blocks (reconciliation path in production).
    if (!webhookDelivered) {
      const settled = await db.order.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          events: { create: { status: "PAID", message: "Payment confirmed (direct settlement fallback)." } },
        },
      });
      await db.payout.updateMany({ where: { orderId: order.id }, data: { status: "AVAILABLE" } });
      await emitRealtime({
        event: "order:new",
        rooms: roomsForOrder({
          userId: user?.id ?? null,
          storeIds: [...new Set(split.lines.map((l) => l.storeId))],
        }),
        payload: {
          orderId: settled.id,
          orderNumber: settled.orderNumber,
          status: settled.status,
          total: settled.total,
          commissionTotal: settled.commissionTotal,
          itemCount: cart.items.reduce((s, i) => s + i.quantity, 0),
          customerName: settled.customerName,
        },
      }).catch(() => undefined);
    }

    const finalOrder = await db.order.findUnique({
      where: { id: order.id },
      include: { items: true, events: { orderBy: { createdAt: "asc" } } },
    });

    return NextResponse.json(
      {
        order: finalOrder,
        payment: {
          intentId: intent.id,
          status: "succeeded",
          platformCommissionCents: split.commissionTotal,
          transfers: split.lines.map((l) => ({
            storeName: l.storeName,
            transferId: l.transferId,
            vendorEarningsCents: l.vendorEarnings,
          })),
          webhookDelivered,
        },
      },
      { status: 201 }
    );
  }
);
