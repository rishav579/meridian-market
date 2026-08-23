import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, parseBody, ApiError } from "@/lib/api";
import { productUpdateSchema } from "@/lib/validation";
import { cacheInvalidatePrefix } from "@/lib/cache";

interface Ctx {
  params: Promise<{ id: string }>;
  user: import("@/lib/auth").SessionUser | null;
}

export const GET = withApi<Ctx>(
  { rateLimit: { limit: 120, windowMs: 60_000 } },
  async (_req, { params }) => {
    const { id } = await params;
    const product = await db.product.findUnique({
      where: { id },
      include: {
        store: { select: { id: true, name: true, slug: true, logoEmoji: true, status: true } },
      },
    });
    if (!product || product.store.status !== "ACTIVE") {
      throw new ApiError(404, "NOT_FOUND", "Product not found.");
    }
    return NextResponse.json({ product });
  }
);

export const PATCH = withApi<Ctx>(
  { rateLimit: { limit: 60, windowMs: 60_000 }, roles: ["VENDOR", "ADMIN"] },
  async (req, { params, user }) => {
    const { id } = await params;
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in required.");

    const product = await db.product.findUnique({ where: { id }, include: { store: true } });
    if (!product) throw new ApiError(404, "NOT_FOUND", "Product not found.");
    if (user.role === "VENDOR" && product.storeId !== user.store?.id) {
      throw new ApiError(403, "NOT_OWNER", "You can only edit products in your own store.");
    }

    const input = await parseBody(req, productUpdateSchema);
    const updated = await db.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
        ...(input.compareAtPriceCents !== undefined ? { compareAtPriceCents: input.compareAtPriceCents } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.stock !== undefined ? { stock: input.stock } : {}),
        ...(input.featured !== undefined ? { featured: input.featured } : {}),
      },
      include: { store: { select: { id: true, name: true, slug: true, logoEmoji: true } } },
    });

    cacheInvalidatePrefix("products:");
    return NextResponse.json({ product: updated });
  }
);

export const DELETE = withApi<Ctx>(
  { rateLimit: { limit: 30, windowMs: 60_000 }, roles: ["VENDOR", "ADMIN"] },
  async (_req, { params, user }) => {
    const { id } = await params;
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in required.");

    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new ApiError(404, "NOT_FOUND", "Product not found.");
    if (user.role === "VENDOR" && product.storeId !== user.store?.id) {
      throw new ApiError(403, "NOT_OWNER", "You can only delete products in your own store.");
    }

    // Soft-decouple from carts, keep historical order items intact (snapshot design).
    await db.$transaction([
      db.cartItem.deleteMany({ where: { productId: id } }),
      db.product.delete({ where: { id } }),
    ]);

    cacheInvalidatePrefix("products:");
    return NextResponse.json({ ok: true });
  }
);
