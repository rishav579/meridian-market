import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as adminStatsRoute } from "@/app/api/admin/stats/route";
import { GET as ordersRoute, PATCH as orderPatchRoute } from "@/app/api/orders/[id]/route";
import { GET as ordersListRoute } from "@/app/api/orders/route";
import { PATCH as productPatchRoute, DELETE as productDeleteRoute } from "@/app/api/products/[id]/route";
import { POST as productCreateRoute } from "@/app/api/products/route";
import { GET as payoutsRoute } from "@/app/api/payouts/route";
import { PATCH as storePatchRoute } from "@/app/api/stores/[id]/route";
import {
  apiRequest,
  invoke,
  jsonError,
  loginUser,
  makeOrder,
  makePayout,
  makeProduct,
  makeStore,
  makeUser,
  resetDb,
} from "../helpers/test-utils";

beforeEach(async () => {
  await resetDb();
});

afterAll(() => db.$disconnect());

describe("authentication gate (real withApi pipeline)", () => {
  it("returns 401 for unauthenticated calls to protected APIs", async () => {
    const stats = await invoke(adminStatsRoute, apiRequest("GET", "/api/admin/stats"));
    expect(stats.status).toBe(401);
    expect((await jsonError(stats)).code).toBe("UNAUTHENTICATED");

    const payouts = await invoke(payoutsRoute, apiRequest("GET", "/api/payouts"));
    expect(payouts.status).toBe(401);

    const createProduct = await invoke(
      productCreateRoute,
      apiRequest("POST", "/api/products", { body: {} })
    );
    expect(createProduct.status).toBe(401);

    const patchOrder = await invoke(
      orderPatchRoute,
      apiRequest("PATCH", "/api/orders/whatever", { body: { status: "PAID" } }),
      { id: "whatever" }
    );
    expect(patchOrder.status).toBe(401);
  });
});

describe("role enforcement (backend RBAC, not React)", () => {
  it("blocks customers from the admin analytics API with 403", async () => {
    const customer = await makeUser({ role: "CUSTOMER" });
    await loginUser(customer.id);
    const res = await invoke(adminStatsRoute, apiRequest("GET", "/api/admin/stats"));
    expect(res.status).toBe(403);
    expect((await jsonError(res)).code).toBe("FORBIDDEN");
  });

  it("allows admins through and returns real aggregate stats", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id, { commissionRate: 0.2 });
    const customer = await makeUser();
    const order = await makeOrder({
      userId: customer.id,
      status: "PAID",
      items: [{ storeId: store.id, unitPrice: 2_000, quantity: 2, commissionRate: 0.2 }],
    });

    const admin = await makeUser({ role: "ADMIN" });
    await loginUser(admin.id);
    const res = await invoke(adminStatsRoute, apiRequest("GET", "/api/admin/stats"));
    expect(res.status).toBe(200);
    const stats = (await res.json()) as { gmvCents: number; commissionCents: number; stores: Array<{ id: string }> };
    expect(stats.gmvCents).toBe(order.total);
    expect(stats.commissionCents).toBe(800); // lineTotal 2000×2 = 4000 at rate 0.2
    expect(stats.stores.map((s) => s.id)).toContain(store.id);
  });

  it("blocks customers from admin store moderation (approve/suspend)", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id, { status: "PENDING" });
    const customer = await makeUser();
    await loginUser(customer.id);

    const res = await invoke(
      storePatchRoute,
      apiRequest("PATCH", `/api/stores/${store.id}`, { body: { status: "ACTIVE" } }),
      { id: store.id }
    );
    expect(res.status).toBe(403);
    expect((await db.store.findUniqueOrThrow({ where: { id: store.id } })).status).toBe("PENDING");
  });

  it("blocks customers from creating products (VENDOR/ADMIN only)", async () => {
    const customer = await makeUser({ role: "CUSTOMER" });
    await loginUser(customer.id);
    const res = await invoke(
      productCreateRoute,
      apiRequest("POST", "/api/products", { body: { name: "x" } })
    );
    expect(res.status).toBe(403);
  });

  it("blocks admins from setting order status to PAID (webhook-only)", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const customer = await makeUser();
    const order = await makeOrder({
      userId: customer.id,
      status: "PENDING",
      items: [{ storeId: store.id, unitPrice: 2_000, quantity: 1 }],
    });

    const admin = await makeUser({ role: "ADMIN" });
    await loginUser(admin.id);
    const res = await invoke(
      orderPatchRoute,
      apiRequest("PATCH", `/api/orders/${order.id}`, { body: { status: "PAID" } }),
      { id: order.id }
    );
    expect(res.status).toBe(403);
    expect((await jsonError(res)).code).toBe("FORBIDDEN");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });
});

describe("object-level authorization (IDOR)", () => {
  it("a customer cannot read another customer's order", async () => {
    const ownerVendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(ownerVendor.id);
    const alice = await makeUser({ name: "Alice" });
    const mallory = await makeUser({ name: "Mallory" });
    const order = await makeOrder({ userId: alice.id, items: [{ storeId: store.id }] });

    await loginUser(mallory.id);
    const res = await invoke(ordersRoute, apiRequest("GET", `/api/orders/${order.id}`), { id: order.id });
    expect(res.status).toBe(403);
    expect((await jsonError(res)).code).toBe("FORBIDDEN");
  });

  it("an unauthenticated caller cannot read an order either", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const alice = await makeUser();
    const order = await makeOrder({ userId: alice.id, items: [{ storeId: store.id }] });

    const res = await invoke(ordersRoute, apiRequest("GET", `/api/orders/${order.id}`), { id: order.id });
    // handler-level object check rejects anonymous access (403, not a data leak)
    expect([401, 403]).toContain(res.status);
  });

  it("a customer cannot transition another customer's order", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const alice = await makeUser();
    const mallory = await makeUser();
    const order = await makeOrder({
      userId: alice.id,
      status: "PAID",
      items: [{ storeId: store.id }],
    });

    await loginUser(mallory.id);
    const res = await invoke(
      orderPatchRoute,
      apiRequest("PATCH", `/api/orders/${order.id}`, { body: { status: "CANCELLED" } }),
      { id: order.id }
    );
    expect(res.status).toBe(403);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
  });

  it("a vendor cannot modify or delete another vendor's product (NOT_OWNER)", async () => {
    const vendorA = await makeUser({ role: "VENDOR" });
    const vendorB = await makeUser({ role: "VENDOR" });
    const storeA = await makeStore(vendorA.id);
    const storeB = await makeStore(vendorB.id);
    const productA = await makeProduct(storeA.id, { name: "A's Item", priceCents: 1_000 });

    await loginUser(vendorB.id);

    const patch = await invoke(
      productPatchRoute,
      apiRequest("PATCH", `/api/products/${productA.id}`, { body: { priceCents: 1 } }),
      { id: productA.id }
    );
    expect(patch.status).toBe(403);
    expect((await jsonError(patch)).code).toBe("NOT_OWNER");
    expect((await db.product.findUniqueOrThrow({ where: { id: productA.id } })).priceCents).toBe(1_000);

    const del = await invoke(productDeleteRoute, apiRequest("DELETE", `/api/products/${productA.id}`), {
      id: productA.id,
    });
    expect(del.status).toBe(403);
    expect(await db.product.count()).toBe(1);
  });

  it("the owning vendor CAN edit their own product through the same route", async () => {
    const vendorA = await makeUser({ role: "VENDOR" });
    const storeA = await makeStore(vendorA.id);
    const productA = await makeProduct(storeA.id, { name: "A's Item", priceCents: 1_000 });

    await loginUser(vendorA.id);
    const patch = await invoke(
      productPatchRoute,
      apiRequest("PATCH", `/api/products/${productA.id}`, { body: { priceCents: 1_250 } }),
      { id: productA.id }
    );
    expect(patch.status).toBe(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: productA.id } })).priceCents).toBe(1_250);
  });
});

describe("vendor data scoping (multi-tenant isolation)", () => {
  it("vendors see only orders containing their own store's items", async () => {
    const vendorA = await makeUser({ role: "VENDOR" });
    const vendorB = await makeUser({ role: "VENDOR" });
    const storeA = await makeStore(vendorA.id, { name: "Store A" });
    const storeB = await makeStore(vendorB.id, { name: "Store B" });
    const customer = await makeUser();

    const orderA = await makeOrder({ userId: customer.id, items: [{ storeId: storeA.id }] });
    await makeOrder({ userId: customer.id, items: [{ storeId: storeB.id }] });

    await loginUser(vendorA.id);
    const res = await invoke(ordersListRoute, apiRequest("GET", "/api/orders"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      orders: Array<{ id: string; items: Array<{ storeId: string }> }>;
    };
    expect(body.orders.map((o) => o.id)).toEqual([orderA.id]);
    for (const order of body.orders) {
      for (const item of order.items) {
        expect(item.storeId).toBe(storeA.id);
      }
    }
  });

  it("a vendor cannot open another store's order detail even by ID", async () => {
    const vendorA = await makeUser({ role: "VENDOR" });
    const vendorB = await makeUser({ role: "VENDOR" });
    const storeA = await makeStore(vendorA.id);
    const storeB = await makeStore(vendorB.id);
    const other = await makeOrder({ items: [{ storeId: storeB.id }] });

    await loginUser(vendorA.id);
    const res = await invoke(ordersRoute, apiRequest("GET", `/api/orders/${other.id}`), { id: other.id });
    expect(res.status).toBe(403);
  });

  it("payout ledgers are scoped per vendor store", async () => {
    const vendorA = await makeUser({ role: "VENDOR" });
    const vendorB = await makeUser({ role: "VENDOR" });
    const storeA = await makeStore(vendorA.id);
    const storeB = await makeStore(vendorB.id);
    const order = await makeOrder({ items: [{ storeId: storeA.id }, { storeId: storeB.id }] });
    const payoutA = await makePayout(storeA.id, order.id, 900);
    const payoutB = await makePayout(storeB.id, order.id, 700);

    await loginUser(vendorA.id);
    const resA = await invoke(payoutsRoute, apiRequest("GET", "/api/payouts"));
    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as { payouts: Array<{ id: string; amount: number }> };
    expect(bodyA.payouts.map((p) => p.id)).toEqual([payoutA.id]);
    expect(bodyA.payouts[0].amount).toBe(900);

    await loginUser(vendorB.id);
    const resB = await invoke(payoutsRoute, apiRequest("GET", "/api/payouts"));
    const bodyB = (await resB.json()) as { payouts: Array<{ id: string }> };
    expect(bodyB.payouts.map((p) => p.id)).toEqual([payoutB.id]);

    const admin = await makeUser({ role: "ADMIN" });
    await loginUser(admin.id);
    const resAdmin = await invoke(payoutsRoute, apiRequest("GET", "/api/payouts"));
    const bodyAdmin = (await resAdmin.json()) as { payouts: Array<{ id: string }> };
    expect(bodyAdmin.payouts.map((p) => p.id).sort()).toEqual([payoutA.id, payoutB.id].sort());
  });

  it("customers only see their own orders in the list endpoint", async () => {
    const vendor = await makeUser({ role: "VENDOR" });
    const store = await makeStore(vendor.id);
    const alice = await makeUser();
    const bob = await makeUser();
    const aliceOrder = await makeOrder({ userId: alice.id, items: [{ storeId: store.id }] });
    await makeOrder({ userId: bob.id, items: [{ storeId: store.id }] });

    await loginUser(alice.id);
    const res = await invoke(ordersListRoute, apiRequest("GET", "/api/orders"));
    const body = (await res.json()) as { orders: Array<{ id: string }> };
    expect(body.orders.map((o) => o.id)).toEqual([aliceOrder.id]);
  });
});
