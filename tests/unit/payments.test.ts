import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildEvent,
  computeSplits,
  createPaymentIntent,
  signWebhook,
  verifyWebhookSignature,
} from "@/lib/payments";

const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_test_secret_for_vitest_only";

function signWithSecret(payload: string, secret: string, timestamp = Date.now()): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

describe("webhook signature verification (real payments.ts)", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });

  it("accepts a correctly signed payload", () => {
    const verdict = verifyWebhookSignature(payload, signWebhook(payload));
    expect(verdict.valid).toBe(true);
  });

  it("rejects a tampered body (signature computed over different bytes)", () => {
    const header = signWebhook(payload);
    const tampered = payload.replace("succeeded", "failed");
    const verdict = verifyWebhookSignature(tampered, header);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe("Signature mismatch");
  });

  it("rejects a missing header before parsing the body", () => {
    const verdict = verifyWebhookSignature(payload, null);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe("Missing stripe-signature header");
  });

  it("rejects a malformed header without v1", () => {
    const verdict = verifyWebhookSignature(payload, "t=1234567890");
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe("Malformed signature header");
  });

  it("rejects a non-numeric timestamp", () => {
    const mac = createHmac("sha256", SECRET).update(`abc.${payload}`).digest("hex");
    const verdict = verifyWebhookSignature(payload, `t=abc,v1=${mac}`);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe("Invalid timestamp");
  });

  it("rejects a signature older than the 5-minute replay window", () => {
    const stale = signWebhook(payload, Date.now() - 6 * 60 * 1000);
    const verdict = verifyWebhookSignature(payload, stale);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe("Signature timestamp outside replay window");
  });

  it("rejects timestamps in the future beyond the replay window", () => {
    const future = signWebhook(payload, Date.now() + 6 * 60 * 1000);
    expect(verifyWebhookSignature(payload, future).valid).toBe(false);
  });

  it("rejects signatures minted with the wrong secret (forgery)", () => {
    const forged = signWithSecret(payload, "whsec_attacker_controlled");
    const verdict = verifyWebhookSignature(payload, forged);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe("Signature mismatch");
  });
});

describe("simulated payment lifecycle (real payments.ts)", () => {
  it("creates a PaymentIntent with Stripe-shaped identifiers", () => {
    const intent = createPaymentIntent(5_000);
    expect(intent.id).toMatch(/^pi_[0-9a-f]{24}$/);
    expect(intent.clientSecret).toContain(intent.id);
    expect(intent.amount).toBe(5_000);
    expect(intent.status).toBe("requires_capture");
  });

  it("computes multi-store splits that sum exactly to the subtotal", () => {
    const split = computeSplits([
      { storeId: "storeA", storeName: "A", unitPriceCents: 4_000, quantity: 3, commissionRate: 0.25 },
      { storeId: "storeB", storeName: "B", unitPriceCents: 2_500, quantity: 1, commissionRate: 0.1 },
    ]);
    expect(split.subtotal).toBe(14_500);
    expect(split.commissionTotal).toBe(3_250); // 3000 + 250
    expect(split.vendorTotal).toBe(11_250);
    expect(split.commissionTotal + split.vendorTotal).toBe(split.subtotal);
    for (const line of split.lines) {
      expect(line.commission + line.vendorEarnings).toBe(line.lineTotal);
      expect(line.transferId).toMatch(/^tr_[0-9a-f]{20}$/);
    }
    const ids = new Set(split.lines.map((l) => l.transferId));
    expect(ids.size).toBe(split.lines.length);
  });
});

describe("buildEvent (real webhook factory)", () => {
  it("produces an event whose own signature verifies against the real verifier", () => {
    const { event, payload, signature } = buildEvent("transfer.created", { id: "tr_test" });
    expect(event.type).toBe("transfer.created");
    expect(event.id).toMatch(/^evt_[0-9a-f]{20}$/);
    expect(JSON.parse(payload)).toEqual(event);
    expect(verifyWebhookSignature(payload, signature).valid).toBe(true);
  });
});
