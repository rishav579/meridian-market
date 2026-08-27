import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildEvent, signWebhook } from "@/lib/payments";
import { POST as webhookRoute } from "@/app/api/webhooks/stripe/route";
import {
  makeOrder,
  makePayout,
  makeStore,
  makeUser,
  nextIp,
  resetDb,
} from "../helpers/test-utils";
import { NextRequest } from "next/server";

function webhookRequest(payload: string, signature?: string): NextRequest {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": nextIp(),
  });
  if (signature) headers.set("stripe-signature", signature);
  return new NextRequest("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: payload,
  });
}

async function postWebhook(payload: string, signature?: string): Promise<Response> {
  return webhookRoute(webhookRequest(payload, signature));
}

interface Fixture {
  orderId: string;
  intentId: string;
  payoutId: string;
}

async function seedPendingOrder(): Promise<Fixture> {
  const vendor = await makeUser({ role: "VENDOR" });
  const store = await makeStore(vendor.id);
  const customer = await makeUser();
  const intentId = `pi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const order = await makeOrder({
    userId: customer.id,
    status: "PENDING",
    paymentIntentId: intentId,
    items: [{ storeId: store.id, unitPrice: 2_000, quantity: 1 }],
  });
  const payout = await makePayout(store.id, order.id, 1_800);
  return { orderId: order.id, intentId, payoutId: payout.id };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(() => db.$disconnect());

describe("POST /api/webhooks/stripe (real route, real HMAC verifier)", () => {
  it("flips the order to PAID and payouts to AVAILABLE on a valid payment_intent.succeeded", async () => {
    const fx = await seedPendingOrder();
    const { payload, signature } = buildEvent("payment_intent.succeeded", {
      id: fx.intentId,
      amount: 2_000,
      currency: "usd",
      metadata: { orderId: fx.orderId },
    });

    const res = await postWebhook(payload, signature);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true });

    const order = await db.order.findUniqueOrThrow({ where: { id: fx.orderId } });
    expect(order.status).toBe("PAID");
    const events = await db.orderEvent.findMany({ where: { orderId: fx.orderId } });
    expect(events.filter((e) => e.status === "PAID")).toHaveLength(1);

    const payout = await db.payout.findUniqueOrThrow({ where: { id: fx.payoutId } });
    expect(payout.status).toBe("AVAILABLE");
  });

  it("is idempotent — replaying the same settled event is a no-op", async () => {
    const fx = await seedPendingOrder();
    const { payload, signature } = buildEvent("payment_intent.succeeded", {
      id: fx.intentId,
      amount: 2_000,
      metadata: { orderId: fx.orderId },
    });

    expect((await postWebhook(payload, signature)).status).toBe(200);
    const eventsAfterFirst = await db.orderEvent.count({ where: { orderId: fx.orderId } });
    const payoutsAfterFirst = (await db.payout.findUniqueOrThrow({ where: { id: fx.payoutId } })).status;

    const replay = await postWebhook(payload, signature); // byte-identical replay
    expect(replay.status).toBe(200);

    const order = await db.order.findUniqueOrThrow({ where: { id: fx.orderId } });
    expect(order.status).toBe("PAID");
    expect(await db.orderEvent.count({ where: { orderId: fx.orderId } })).toBe(eventsAfterFirst);
    expect((await db.payout.findUniqueOrThrow({ where: { id: fx.payoutId } })).status).toBe(payoutsAfterFirst);
  });

  it("rejects an invalid signature with 400 and leaves the order PENDING", async () => {
    const fx = await seedPendingOrder();
    const { payload } = buildEvent("payment_intent.succeeded", {
      id: fx.intentId,
      metadata: { orderId: fx.orderId },
    });

    const res = await postWebhook(payload, "t=1700000000000,v1=deadbeefdeadbeefdeadbeefdeadbeef");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_SIGNATURE");

    expect((await db.order.findUniqueOrThrow({ where: { id: fx.orderId } })).status).toBe("PENDING");
  });

  it("rejects a missing signature header — unsigned frontend-style JSON cannot settle payments", async () => {
    const fx = await seedPendingOrder();
    // exactly what a malicious client would POST straight from the browser
    const forged = JSON.stringify({
      id: "evt_forge",
      type: "payment_intent.succeeded",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: fx.intentId, metadata: { orderId: fx.orderId } } },
    });

    const res = await postWebhook(forged);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_SIGNATURE");

    expect((await db.order.findUniqueOrThrow({ where: { id: fx.orderId } })).status).toBe("PENDING");
    expect(await db.orderEvent.count({ where: { orderId: fx.orderId } })).toBe(1); // only the placement event
  });

  it("rejects signatures minted with the wrong secret", async () => {
    const fx = await seedPendingOrder();
    const { payload } = buildEvent("payment_intent.succeeded", {
      id: fx.intentId,
      metadata: { orderId: fx.orderId },
    });
    const rightSecretSig = signWebhook(payload);
    const tamperedHeader = `${rightSecretSig.slice(0, -8)}00000000`; // valid shape, wrong mac

    const res = await postWebhook(payload, tamperedHeader);
    expect(res.status).toBe(400);
    expect((await db.order.findUniqueOrThrow({ where: { id: fx.orderId } })).status).toBe("PENDING");
  });

  it("rejects an event whose timestamp is outside the replay window", async () => {
    const fx = await seedPendingOrder();
    const { payload } = buildEvent("payment_intent.succeeded", {
      id: fx.intentId,
      metadata: { orderId: fx.orderId },
    });
    const expiredSignature = signWebhook(payload, Date.now() - 10 * 60 * 1000);

    const res = await postWebhook(payload, expiredSignature);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      "replay window"
    );
    expect((await db.order.findUniqueOrThrow({ where: { id: fx.orderId } })).status).toBe("PENDING");
  });

  it("marks payouts AVAILABLE on transfer.created by transferId", async () => {
    const fx = await seedPendingOrder();
    const payout = await db.payout.findUniqueOrThrow({ where: { id: fx.payoutId } });
    expect(payout.transferId).toBeTruthy();

    const { payload, signature } = buildEvent("transfer.created", { id: payout.transferId });
    const res = await postWebhook(payload, signature);
    expect(res.status).toBe(200);

    expect((await db.payout.findUniqueOrThrow({ where: { id: fx.payoutId } })).status).toBe("AVAILABLE");
    // transfer events never touch the order itself
    expect((await db.order.findUniqueOrThrow({ where: { id: fx.orderId } })).status).toBe("PENDING");
  });

  it("acknowledges events referencing unknown orders instead of crashing", async () => {
    const { payload, signature } = buildEvent("payment_intent.succeeded", {
      id: "pi_missing",
      metadata: { orderId: "order_does_not_exist" },
    });
    const res = await postWebhook(payload, signature);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, ignored: "unknown order" });
  });

  it("ignores unhandled payloads gracefully (no metadata)", async () => {
    const { payload, signature } = buildEvent("transfer.created", {});
    const res = await postWebhook(payload, signature);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true });
  });

  it("rejects malformed JSON even when correctly signed (verify happens before parse)", async () => {
    const payload = "{not json at all";
    const res = await postWebhook(payload, signWebhook(payload));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BAD_PAYLOAD");
  });

  it("accepts no cookies and no session — the HMAC signature IS the authentication", async () => {
    // The webhook route deliberately bypasses withApi (no session/CSRF):
    // an anonymous request without a signature must still be HMAC-rejected.
    const req = new NextRequest("http://localhost:3000/api/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
      body: JSON.stringify({ type: "payment_intent.succeeded" }),
    });
    const res = await webhookRoute(req);
    expect(res.status).toBe(400);
  });
});
