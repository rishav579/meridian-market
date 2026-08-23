/** Shared client-side types mirroring the API contract (kept in sync manually — single route app). */

export type Role = "ADMIN" | "VENDOR" | "CUSTOMER";
export type OrderStatus = "PENDING" | "PAID" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED";
export type StoreStatus = "PENDING" | "ACTIVE" | "SUSPENDED";
export type PayoutStatus = "PENDING" | "AVAILABLE" | "PAID" | "REVERSED";

export interface StoreRef {
  id: string;
  name: string;
  slug: string;
  logoEmoji: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  store: { id: string; name: string; slug: string; status: StoreStatus; commissionRate: number } | null;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  imageUrl: string;
  category: string;
  tags: string;
  stock: number;
  rating: number;
  reviewCount: number;
  featured: boolean;
  store: StoreRef;
  createdAt?: string;
}

export interface CartLine {
  productId: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  name: string;
  imageUrl: string;
  slug: string;
  stock: number;
  store: StoreRef;
}

export interface CartState {
  items: CartLine[];
  subtotalCents: number;
  itemCount: number;
}

export interface OrderEvent {
  id: string;
  status: OrderStatus;
  message: string;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  productName: string;
  storeName: string;
  storeId: string;
  imageUrl: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  commissionRate: number;
  commission: number;
  vendorEarnings: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  status: OrderStatus;
  subtotal: number;
  commissionTotal: number;
  total: number;
  guestEmail?: string | null;
  createdAt: string;
  items: OrderItem[];
  events: OrderEvent[];
}

export interface CheckoutResult {
  order: Order;
  payment: {
    intentId: string;
    status: string;
    platformCommissionCents: number;
    transfers: Array<{ storeName: string; transferId: string; vendorEarningsCents: number }>;
    webhookDelivered: boolean;
  };
}

export interface StoreRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  logoEmoji: string;
  status: StoreStatus;
  commissionRate: number;
  vendor: { name: string };
  _count: { products: number };
}

export interface Payout {
  id: string;
  amount: number;
  status: PayoutStatus;
  transferId: string | null;
  createdAt: string;
  order: { orderNumber: string } | null;
  store?: { name: string };
}

export interface AdminStats {
  gmvCents: number;
  commissionCents: number;
  orderCount: number;
  productCount: number;
  userCount: number;
  vendorCount: number;
  pendingStoreCount: number;
  byStatus: Record<string, number>;
  stores: Array<{
    id: string;
    name: string;
    status: StoreStatus;
    commissionRate: number;
    productCount: number;
    revenueCents: number;
    vendorEarningsCents: number;
  }>;
  payouts: Array<{ status: string; count: number; amountCents: number }>;
  categories: string[];
}

export interface AssistantProduct {
  id: string;
  name: string;
  priceCents: number;
  category: string;
  storeName: string;
  imageUrl: string;
  rating: number;
  stock: number;
  slug: string;
}

export interface AssistantResult {
  sessionId: string;
  reply: string;
  products: AssistantProduct[];
  degraded: boolean;
}

export interface RealtimeFeedItem {
  id: string;
  event: "order:new" | "order:status" | "payout:update";
  label: string;
  detail: string;
  at: string;
}
