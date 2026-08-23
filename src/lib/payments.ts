/**
 * Simulated Stripe Connect (destination charges + separate transfers).
 *
 * Why simulated: this sandbox has no Stripe API keys; the module reproduces the
 * exact production contract — PaymentIntent lifecycle, per-store Connect
 * transfers after the platform's commission, and HMAC-SHA256 webhook signing
 * (`t=<ts>,v1=<sig>` over `<ts>.<payload>`) with timing-safe verification and
 * replay-window rejection. Swapping `sim` for `stripe` SDK calls is confined to
 * the three functions below; the webhook verifier stays identical.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { computeLineSplit } from "@/lib/money";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_sim_4f8b2c1a9e7d";
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export interface SplitLine {
  storeId: string;
  storeName: string;
  unitPriceCents: number;
  quantity: number;
  commissionRate: number;
}

export interface SplitResult {
  lines: Array<{
    storeId: string;
    storeName: string;
    lineTotal: number;
    commission: number;
    vendorEarnings: number;
    transferId: string;
  }>;
  subtotal: number;
  commissionTotal: number;
  vendorTotal: number;
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string;
  amount: number;
  status: "requires_capture" | "succeeded";
}

// Payment lifecycle

export function createPaymentIntent(amountCents: number): PaymentIntentResult {
  const id = `pi_${randomBytes(12).toString("hex")}`;
  return {
    id,
    clientSecret: `${id}_secret_${randomBytes(8).toString("hex")}`,
    amount: amountCents,
    status: "requires_capture",
  };
}

/** Capture the intent and issue one Connect transfer per store for vendor earnings. */
export function captureWithSplits(intentId: string, lines: SplitLine[]): { intent: PaymentIntentResult; split: SplitResult } {
  const split = computeSplits(lines);
  return {
    intent: { id: intentId, clientSecret: "", amount: split.subtotal, status: "succeeded" },
    split,
  };
}

export function computeSplits(lines: SplitLine[]): SplitResult {
  let subtotal = 0;
  let commissionTotal = 0;
  let vendorTotal = 0;
  const out = lines.map((line) => {
    const { lineTotal, commission, vendorEarnings } = computeLineSplit(
      line.unitPriceCents,
      line.quantity,
      line.commissionRate
    );
    subtotal += lineTotal;
    commissionTotal += commission;
    vendorTotal += vendorEarnings;
    return {
      storeId: line.storeId,
      storeName: line.storeName,
      lineTotal,
      commission,
      vendorEarnings,
      transferId: `tr_${randomBytes(10).toString("hex")}`,
    };
  });
  return { lines: out, subtotal, commissionTotal, vendorTotal };
}

// Webhook signing & verification (mirrors stripe constructEvent)

export function signWebhook(payload: string, timestamp = Date.now()): string {
  const mac = createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

export function verifyWebhookSignature(payload: string, signatureHeader: string | null): { valid: boolean; reason?: string } {
  if (!signatureHeader) return { valid: false, reason: "Missing stripe-signature header" };

  const parts = signatureHeader.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k] = v;
    return acc;
  }, {});
  const timestamp = parts["t"];
  const provided = parts["v1"];
  if (!timestamp || !provided) return { valid: false, reason: "Malformed signature header" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { valid: false, reason: "Invalid timestamp" };
  if (Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
    return { valid: false, reason: "Signature timestamp outside replay window" };
  }

  const expected = createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest("hex");
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "Signature mismatch" };
  }
  return { valid: true };
}

// Event factory

export interface WebhookEvent {
  id: string;
  type: "payment_intent.succeeded" | "transfer.created";
  created: number;
  data: { object: Record<string, unknown> };
}

export function buildEvent(
  type: WebhookEvent["type"],
  object: Record<string, unknown>
): { event: WebhookEvent; payload: string; signature: string } {
  const event: WebhookEvent = {
    id: `evt_${randomBytes(10).toString("hex")}`,
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
  const payload = JSON.stringify(event);
  return { event, payload, signature: signWebhook(payload) };
}
