/**
 * Zod validation schemas — the single validation boundary for every mutating
 * API route. Strings are trimmed + length-capped (input sanitization); enums
 * are closed literal unions. Parsed output is the only thing that reaches Prisma.
 */

import { z } from "zod";
import { ROLES, CATEGORIES, ORDER_STATUSES, STORE_STATUSES } from "@/lib/constants";

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72)
  .regex(/[A-Za-z]/, "Must contain a letter")
  .regex(/[0-9!@#$%^&*]/, "Must contain a number or symbol");

const email = z.email().max(160).transform((v) => v.toLowerCase().trim());
const safeText = (max: number) => z.string().trim().min(1).max(max);

export const signupSchema = z.object({
  name: safeText(80),
  email,
  password,
  role: z.enum(["CUSTOMER", "VENDOR"]).default("CUSTOMER"),
  storeName: z.string().trim().max(80).optional(),
  storeDescription: z.string().trim().max(500).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(72),
});

export const productCreateSchema = z.object({
  name: safeText(120),
  description: safeText(2000),
  priceCents: z.number().int().min(50).max(10_000_000), // $0.50 – $100k
  compareAtPriceCents: z.number().int().min(50).max(10_000_000).nullable().optional(),
  imageUrl: z.string().trim().min(1).max(500),
  category: z.enum(CATEGORIES),
  tags: z.string().trim().max(200).default(""),
  stock: z.number().int().min(0).max(100_000),
  featured: z.boolean().default(false),
});

export const productUpdateSchema = productCreateSchema.partial();

export const storeCreateSchema = z.object({
  name: safeText(80),
  description: safeText(500),
  logoEmoji: z.string().trim().max(8).default("🏬"),
});

export const storeAdminPatchSchema = z.object({
  status: z.enum(STORE_STATUSES).optional(),
  commissionRate: z.number().min(0).max(0.5).optional(),
});

export const cartAddSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(20).default(1),
});

export const cartUpdateSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(0).max(20), // 0 removes
});

export const checkoutSchema = z.object({
  shippingName: safeText(80),
  email,
  line1: safeText(160),
  city: safeText(80),
  state: z.string().trim().max(80).optional().or(z.literal("")),
  postal: safeText(20),
  country: z.string().trim().length(2).default("US"),
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
});

export const orderStatusPatchSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

export const chatSchema = z.object({
  sessionId: z.string().min(1).max(64).optional(),
  message: safeText(500),
});

export const productQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.enum(CATEGORIES).optional(),
  minPriceCents: z.coerce.number().int().min(0).optional(),
  maxPriceCents: z.coerce.number().int().min(0).optional(),
  storeSlug: z.string().trim().max(120).optional(),
  sort: z.enum(["relevance", "price-asc", "price-desc", "rating", "newest"]).default("relevance"),
  featured: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ProductQuery = z.infer<typeof productQuerySchema>;
