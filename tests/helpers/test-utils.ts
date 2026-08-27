import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { cacheInvalidatePrefix } from "@/lib/cache";
import { hashPassword, type SessionUser } from "@/lib/auth";
import { clearCookies, setCookie } from "../setup";

// ---------------------------------------------------------------------------
// HTTP helpers — build real NextRequest objects and invoke real route handlers
// through the actual withApi pipeline (rate limit → CSRF → session → RBAC).
// ---------------------------------------------------------------------------

let ipCounter = 0;

/** Unique per-request loopback IP so rate-limiter buckets never collide. */
export function nextIp(): string {
  ipCounter += 1;
  return `10.77.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

export function apiRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: RequestOptions = {}
): NextRequest {
  const headers = new Headers(opts.headers ?? {});
  headers.set("x-forwarded-for", nextIp());
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(`http://localhost:3000${path}`, { method, headers, body });
}

type AnyRoute = (req: NextRequest, ctx: never) => Promise<Response>;

/** Invoke a route handler exactly as the Next.js runtime would. */
export async function invoke(
  route: (req: NextRequest, ctx: never) => Promise<Response>,
  req: NextRequest,
  params: Record<string, string> = {}
): Promise<Response> {
  return route(req, {
    params: Promise.resolve(params),
  } as never);
}

export async function jsonError(res: Response): Promise<{ code?: string; message?: string }> {
  try {
    const parsed = (await res.json()) as { error?: { code?: string; message?: string } };
    return parsed.error ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Session helpers — create real DB-backed sessions and drive them through the
// mocked cookie jar (same cookie name/flow the production code uses).
// ---------------------------------------------------------------------------

export async function loginUser(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  // Make the cookie visible synchronously so fire-and-forget callers can never
  // race the DB roundtrip below.
  setCookie("mk_session", token);
  await db.session.create({
    data: { token, userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  return token;
}

export function logout(): void {
  clearCookies();
}

export async function sessionUserFor(userId: string): Promise<SessionUser> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { store: true } });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionUser["role"],
    store: user.store
      ? {
          id: user.store.id,
          name: user.store.name,
          slug: user.store.slug,
          status: user.store.status,
          commissionRate: user.store.commissionRate,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Deterministic fixtures — explicit IDs, fixed values, unique emails/slugs.
// ---------------------------------------------------------------------------

const suffix = randomBytes(4).toString("hex");

export function uid(prefix: string): string {
  return `${prefix}_${suffix}_${randomBytes(4).toString("hex")}`;
}

export interface UserSpec {
  email?: string;
  role?: "ADMIN" | "VENDOR" | "CUSTOMER";
  name?: string;
}

export async function makeUser(spec: UserSpec = {}) {
  return db.user.create({
    data: {
      id: uid("usr"),
      email: spec.email ?? `${uid("user").replace(/_/g, ".")}@test.local`,
      name: spec.name ?? `Test ${spec.role ?? "CUSTOMER"}`,
      passwordHash: hashPassword("Password123!"),
      role: spec.role ?? "CUSTOMER",
    },
  });
}

export interface StoreSpec {
  status?: "PENDING" | "ACTIVE" | "SUSPENDED";
  commissionRate?: number;
  slug?: string;
  name?: string;
}

export async function makeStore(vendorId: string, spec: StoreSpec = {}) {
  return db.store.create({
    data: {
      id: uid("str"),
      name: spec.name ?? "Test Store",
      slug: spec.slug ?? uid("store"),
      description: "Store used by automated tests.",
      status: spec.status ?? "ACTIVE",
      commissionRate: spec.commissionRate ?? 0.1,
      vendorId,
    },
  });
}

export interface ProductSpec {
  name: string;
  priceCents: number;
  stock?: number;
  tags?: string;
  description?: string;
  category?: string;
  rating?: number;
  featured?: boolean;
}

export async function makeProduct(storeId: string, spec: ProductSpec) {
  return db.product.create({
    data: {
      id: uid("prd"),
      name: spec.name,
      slug: uid("prod"),
      description: spec.description ?? spec.name,
      priceCents: spec.priceCents,
      imageUrl: "/products/test.jpg",
      category: spec.category ?? "Audio",
      tags: spec.tags ?? "",
      stock: spec.stock ?? 10,
      rating: spec.rating ?? 4.0,
      featured: spec.featured ?? false,
      storeId,
    },
  });
}

export interface OrderItemSpec {
  storeId: string;
  productId?: string | null;
  productName?: string;
  storeName?: string;
  unitPrice?: number;
  quantity?: number;
  commissionRate?: number;
}

export interface OrderSpec {
  userId?: string | null;
  guestEmail?: string;
  status?: string;
  paymentIntentId?: string;
  orderNumber?: string;
  items: OrderItemSpec[];
}

/** Insert an order directly (bypasses checkout) for authorization-scoping tests. */
export async function makeOrder(spec: OrderSpec) {
  const lines = spec.items.map((item) => {
    const unitPrice = item.unitPrice ?? 1000;
    const quantity = item.quantity ?? 1;
    const lineTotal = unitPrice * quantity;
    const commissionRate = item.commissionRate ?? 0.1;
    const commission = Math.round(lineTotal * commissionRate);
    return {
      storeId: item.storeId,
      productId: item.productId ?? null,
      productName: item.productName ?? "Test Product",
      storeName: item.storeName ?? "Test Store",
      imageUrl: "/products/test.jpg",
      unitPrice,
      quantity,
      lineTotal,
      commissionRate,
      commission,
      vendorEarnings: lineTotal - commission,
    };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const commissionTotal = lines.reduce((sum, l) => sum + l.commission, 0);
  return db.order.create({
    data: {
      id: uid("ord"),
      orderNumber: spec.orderNumber ?? uid("MK").toUpperCase(),
      userId: spec.userId ?? null,
      guestEmail: spec.guestEmail ?? null,
      customerName: "Test Shopper",
      status: spec.status ?? "PENDING",
      subtotal,
      commissionTotal,
      shippingFee: 0,
      total: subtotal,
      paymentIntentId: spec.paymentIntentId ?? uid("pi"),
      shippingName: "Test Shopper",
      shippingLine1: "1 Test Way",
      shippingCity: "Testville",
      shippingPostal: "00000",
      shippingCountry: "US",
      items: { create: lines },
      events: {
        create: { status: spec.status ?? "PENDING", message: "Order placed (test fixture)." },
      },
    },
  });
}

export async function makePayout(storeId: string, orderId: string, amount = 900) {
  return db.payout.create({
    data: {
      id: uid("pay"),
      storeId,
      orderId,
      amount,
      status: "PENDING",
      transferId: uid("tr"),
    },
  });
}

/** Wipe every table in FK-safe order and clear in-process caches. */
export async function resetDb(): Promise<void> {
  await db.chatMessage.deleteMany();
  await db.chatSession.deleteMany();
  await db.payout.deleteMany();
  await db.orderEvent.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.cartItem.deleteMany();
  await db.cart.deleteMany();
  await db.product.deleteMany();
  await db.store.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  cacheInvalidatePrefix("");
  clearCookies();
}
