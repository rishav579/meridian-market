import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { GET as getCartRoute, POST as addToCartRoute } from "@/app/api/cart/route";
import {
  apiRequest,
  invoke,
  jsonError,
  loginUser,
  logout,
  makeProduct,
  makeStore,
  makeUser,
  resetDb,
} from "../helpers/test-utils";

const SHIPPING = {
  shippingName: "Casey Shopper",
  email: "casey@test.local",
  line1: "1 Main Street",
  city: "Springfield",
  state: "IL",
  postal: "62704",
  country: "US",
};

async function addToCart(productId: string, quantity: number): Promise<Response> {
  return invoke(addToCartRoute, apiRequest("POST", "/api/cart", { body: { productId, quantity } }));
}

async function runCheckout(body: unknown = SHIPPING, headers: Record<string, string> = {}): Promise<Response> {
  return invoke(checkoutRoute, apiRequest("POST", "/api/checkout", { body, headers }));
}

beforeEach(async () => {
  await resetDb();
});

afterAll(() => db.$disconnect());

describe("POST /api/checkout (real route + real Prisma transaction)", () => {
  it("creates exactly one atomic order, snapshots the split, decrements stock and clears the cart", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id, { commissionRate: 0.25 });
    const product = await makeProduct(store.id, { name: "Trail Shoe", priceCents: 4_000, stock: 10 });
    const customer = await makeUser();

    await loginUser(customer.id);
    const added = await addAndParse(product.id, 3);
    expect(added.itemCount).toBe(3);

    const ordersBefore = await db.order.count();
    const res = await runCheckout();
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      order: { id: string; orderNumber: string; status: string; subtotal: number; commissionTotal: number; total: number };
      payment: { platformCommissionCents: number; transfers: Array<{ vendorEarningsCents: number }>; webhookDelivered: boolean };
    };

    // exactly one order was created
    expect(await db.order.count()).toBe(ordersBefore + 1);
    expect(body.order.orderNumber).toMatch(/^MK-\d{4}-[0-9A-F]{8}$/i);

    // server-side money math with the store's real commission rate
    const items = await db.orderItem.findMany({ where: { orderId: body.order.id } });
    expect(items).toHaveLength(1);
    expect(items[0].unitPrice).toBe(4_000);
    expect(items[0].quantity).toBe(3);
    expect(items[0].lineTotal).toBe(12_000);
    expect(items[0].commissionRate).toBe(0.25);
    expect(items[0].commission).toBe(3_000);
    expect(items[0].vendorEarnings).toBe(9_000);
    // name snapshots taken at purchase time
    expect(items[0].productName).toBe("Trail Shoe");
    expect(items[0].storeId).toBe(store.id);
    expect(body.order.subtotal).toBe(12_000);
    expect(body.order.commissionTotal).toBe(3_000);
    expect(body.order.total).toBe(12_000);

    // inventory decremented inside the same transaction
    const refreshed = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(refreshed.stock).toBe(7);

    // cart cleared after successful checkout
    const cartRes = await invoke(getCartRoute, apiRequest("GET", "/api/cart"));
    const cartBody = (await cartRes.json()) as { itemCount: number };
    expect(cartBody.itemCount).toBe(0);

    // per-store Connect transfer recorded as a Payout row; with the internal
    // webhook unreachable (closed loopback port in test env) the documented
    // direct-settlement fallback marks the order PAID and funds AVAILABLE.
    const payouts = await db.payout.findMany({ where: { orderId: body.order.id } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].amount).toBe(9_000);
    expect(payouts[0].transferId).toMatch(/^tr_/);
    expect(payouts[0].status).toBe("AVAILABLE");
    expect(body.payment.transfers[0].vendorEarningsCents).toBe(9_000);
    expect(body.payment.platformCommissionCents).toBe(3_000);
    expect(body.payment.webhookDelivered).toBe(false);

    const settled = await db.order.findUniqueOrThrow({ where: { id: body.order.id } });
    expect(settled.status).toBe("PAID");
    const events = await db.orderEvent.findMany({ where: { orderId: settled.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.status)).toEqual(["PENDING", "PAID"]);
  });

  it("prices the order from the live catalog at checkout time, ignoring stale cart prices", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const product = await makeProduct(store.id, { name: "Desk Lamp", priceCents: 1_000, stock: 10 });
    const customer = await makeUser();

    await loginUser(customer.id);
    const added = await addAndParse(product.id, 2);
    // cart stored its own add-time snapshot…
    expect(added.items[0].unitPriceCents).toBe(1_000);

    // …then the vendor changes the real price before checkout
    await db.product.update({ where: { id: product.id }, data: { priceCents: 2_500 } });

    const res = await runCheckout();
    expect(res.status).toBe(201);
    const { order } = (await res.json()) as { order: { id: string } };
    const [item] = await db.orderItem.findMany({ where: { orderId: order.id } });
    // order reflects the authoritative catalog price, not the stale cart value
    expect(item.unitPrice).toBe(2_500);
    expect(item.lineTotal).toBe(5_000);
  });

  it("rejects checkout when stock became insufficient and creates nothing", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const product = await makeProduct(store.id, { name: "Rare Vinyl", priceCents: 9_900, stock: 5 });
    const customer = await makeUser();

    await loginUser(customer.id);
    await addAndParse(product.id, 5);
    // inventory drops after the cart was filled
    await db.product.update({ where: { id: product.id }, data: { stock: 2 } });

    const ordersBefore = await db.order.count();
    const res = await runCheckout();
    expect(res.status).toBe(409);
    expect((await jsonError(res)).code).toBe("INSUFFICIENT_STOCK");

    expect(await db.order.count()).toBe(ordersBefore);
    expect(await db.payout.count()).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(2);
    // cart is preserved so the shopper can adjust quantities
    expect(await db.cartItem.count()).toBe(1);
  });

  it("rejects an empty cart with 409", async () => {
    await makeUser({ role: "VENDOR" });
    const customer = await makeUser();
    await loginUser(customer.id);

    const ordersBefore = await db.order.count();
    const res = await runCheckout();
    expect(res.status).toBe(409);
    expect((await jsonError(res)).code).toBe("EMPTY_CART");
    expect(await db.order.count()).toBe(ordersBefore);
  });

  it("supports guest checkout: userId stays null, guestEmail persisted, cart cleared", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const product = await makeProduct(store.id, { name: "Guest Mug", priceCents: 1_500, stock: 4 });

    // no session → guest cookie cart
    await addAndParse(product.id, 1);
    const res = await runCheckout({
      ...SHIPPING,
      email: "passerby@example.com",
    });
    expect(res.status).toBe(201);
    const { order } = (await res.json()) as { order: { id: string; userId: string | null; guestEmail: string | null } };
    expect(order.userId).toBeNull();
    expect(order.guestEmail).toBe("passerby@example.com");

    const cartRes = await invoke(getCartRoute, apiRequest("GET", "/api/cart"));
    expect(((await cartRes.json()) as { itemCount: number }).itemCount).toBe(0);
  });

  it("rejects malformed bodies through the shared Zod boundary", async () => {
    const customer = await makeUser();
    await loginUser(customer.id);
    const res = await runCheckout({ shippingName: "", email: "not-an-email", line1: "x".repeat(500) });
    expect(res.status).toBe(422);
    expect((await jsonError(res)).code).toBe("VALIDATION_ERROR");
  });

  it("generates unique order numbers across multiple checkouts without relying on table count", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const product = await makeProduct(store.id, { name: "Pen", priceCents: 500, stock: 20 });
    const customer = await makeUser();
    await loginUser(customer.id);

    const orderNumbers: string[] = [];
    for (let i = 0; i < 3; i++) {
      await addToCart(product.id, 1);
      const res = await runCheckout();
      expect(res.status).toBe(201);
      const body = (await res.json()) as { order: { orderNumber: string } };
      expect(body.order.orderNumber).toMatch(/^MK-\d{4}-[0-9A-F]{8}$/i);
      orderNumbers.push(body.order.orderNumber);
    }

    const uniqueNumbers = new Set(orderNumbers);
    expect(uniqueNumbers.size).toBe(orderNumbers.length);
  });

  it("is idempotent on retrying with the same Idempotency-Key header", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id, { commissionRate: 0.1 });
    const product = await makeProduct(store.id, { name: "Headphones", priceCents: 10_000, stock: 10 });
    const customer = await makeUser();

    await loginUser(customer.id);
    await addToCart(product.id, 2);

    const idempotencyKey = "idem_test_abc_123";
    const res1 = await runCheckout(SHIPPING, { "idempotency-key": idempotencyKey });
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as { order: { id: string; orderNumber: string } };

    // Stock was decremented once (10 -> 8)
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(8);
    expect(await db.order.count()).toBe(1);
    expect(await db.payout.count()).toBe(1);

    // Replay exact same checkout with same idempotency key
    const res2 = await runCheckout(SHIPPING, { "idempotency-key": idempotencyKey });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { order: { id: string; orderNumber: string } };

    // Returns exact same order
    expect(body2.order.id).toBe(body1.order.id);
    expect(body2.order.orderNumber).toBe(body1.order.orderNumber);

    // No duplicate orders, stock decrements, or payouts
    expect(await db.order.count()).toBe(1);
    expect(await db.payout.count()).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(8);
  });

  it("produces exactly one order under concurrent requests with the same idempotency key", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const product = await makeProduct(store.id, { name: "Watch", priceCents: 15_000, stock: 5 });
    const customer = await makeUser();

    await loginUser(customer.id);
    await addToCart(product.id, 1);

    const idempotencyKey = "concurrent_key_xyz_789";
    const [resA, resB] = await Promise.all([
      runCheckout(SHIPPING, { "idempotency-key": idempotencyKey }),
      runCheckout(SHIPPING, { "idempotency-key": idempotencyKey }),
    ]);

    expect([200, 201]).toContain(resA.status);
    expect([200, 201]).toContain(resB.status);

    const bodyA = (await resA.json()) as { order: { id: string } };
    const bodyB = (await resB.json()) as { order: { id: string } };

    expect(bodyA.order.id).toBe(bodyB.order.id);
    expect(await db.order.count()).toBe(1);
    expect(await db.payout.count()).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(4);
  });

  it("creates independent orders for different idempotency keys", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const product = await makeProduct(store.id, { name: "Book", priceCents: 1_200, stock: 10 });
    const customer = await makeUser();

    await loginUser(customer.id);
    await addToCart(product.id, 1);

    const res1 = await runCheckout(SHIPPING, { "idempotency-key": "key-order-1" });
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as { order: { id: string } };

    await addToCart(product.id, 2);
    const res2 = await runCheckout(SHIPPING, { "idempotency-key": "key-order-2" });
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()) as { order: { id: string } };

    expect(body1.order.id).not.toBe(body2.order.id);
    expect(await db.order.count()).toBe(2);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(7);
  });

  it("rejects reuse of another customer's idempotency key with 403", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const product = await makeProduct(store.id, { name: "Mat", priceCents: 2_000, stock: 10 });
    const alice = await makeUser({ name: "Alice" });
    const bob = await makeUser({ name: "Bob" });

    // Alice checks out with key
    await loginUser(alice.id);
    await addToCart(product.id, 1);
    const resAlice = await runCheckout(SHIPPING, { "idempotency-key": "shared-secret-key" });
    expect(resAlice.status).toBe(201);

    // Bob tries to reuse Alice's idempotency key
    await loginUser(bob.id);
    await addToCart(product.id, 1);
    const resBob = await runCheckout(SHIPPING, { "idempotency-key": "shared-secret-key" });
    expect(resBob.status).toBe(403);
    expect((await jsonError(resBob)).code).toBe("FORBIDDEN");
  });

  it("transactionally rolls back payouts and order state when stock allocation fails", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const product = await makeProduct(store.id, { name: "Limited Edition", priceCents: 50_000, stock: 1 });
    const customer = await makeUser();

    await loginUser(customer.id);
    await addToCart(product.id, 1);

    // Set stock to 0 right before checkout
    await db.product.update({ where: { id: product.id }, data: { stock: 0 } });

    const ordersBefore = await db.order.count();
    const payoutsBefore = await db.payout.count();
    const res = await runCheckout();
    expect(res.status).toBe(409);
    expect((await jsonError(res)).code).toBe("INSUFFICIENT_STOCK");

    // Zero residual rows in DB
    expect(await db.order.count()).toBe(ordersBefore);
    expect(await db.payout.count()).toBe(payoutsBefore);
    expect(await db.orderItem.count()).toBe(0);
  });

  // helper shared by the cases above
  async function addAndParse(productId: string, quantity: number): Promise<{
    itemCount: number;
    items: Array<{ unitPriceCents: number }>;
  }> {
    const res = await addToCart(productId, quantity);
    expect(res.status).toBe(200);
    return (await res.json()) as { itemCount: number; items: Array<{ unitPriceCents: number }> };
  }
});
