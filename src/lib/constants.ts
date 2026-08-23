// ─────────────────────────────────────────────────────────────────────────────
// Domain constants & literal union types (single source of truth).
// SQLite/Prisma stores these as String; Zod + TS keep them type-safe end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

export const ROLES = ["ADMIN", "VENDOR", "CUSTOMER"] as const;
export type Role = (typeof ROLES)[number];

export const ORDER_STATUSES = [
  "PENDING",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STORE_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED"] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export const PAYOUT_STATUSES = ["PENDING", "AVAILABLE", "PAID", "REVERSED"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const CATEGORIES = [
  "Footwear",
  "Apparel",
  "Fitness",
  "Audio",
  "Home & Kitchen",
  "Tech Accessories",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PLATFORM_COMMISSION_RATE = 0.1; // 10% platform cut (default per store)

// Cookie names
export const SESSION_COOKIE = "mk_session";
export const GUEST_CART_COOKIE = "mk_guest_cart";
export const CSRF_COOKIE = "mk_csrf";

export const SESSION_TTL_DAYS = 7;

// Valid order-status transitions (state machine enforced in PATCH /api/orders/:id)
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ["PAID", "CANCELLED"],
  PAID: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

// Roles allowed to author a given transition (vendor = owner of a store on the order)
export const TRANSITION_AUTHORS: Partial<Record<OrderStatus, readonly Role[]>> = {
  PAID: ["ADMIN"], // set exclusively by the payment webhook
  PROCESSING: ["ADMIN", "VENDOR"],
  SHIPPED: ["ADMIN", "VENDOR"],
  DELIVERED: ["ADMIN", "VENDOR"],
  CANCELLED: ["ADMIN", "VENDOR", "CUSTOMER"],
};
