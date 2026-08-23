import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, parseBody, ApiError } from "@/lib/api";
import { productCreateSchema, productQuerySchema } from "@/lib/validation";
import { cached, cacheInvalidatePrefix } from "@/lib/cache";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/products — public catalog search.
 * Only products from ACTIVE stores are visible. Short-TTL cached per query
 * signature; invalidated on any product mutation.
 */
export const GET = withApi(
  { rateLimit: { limit: 120, windowMs: 60_000 } },
  async (req, { user }) => {
    const sp = req.nextUrl.searchParams;
    const raw: Record<string, string> = {};
    for (const [k, v] of sp.entries()) if (v !== "") raw[k] = v;
    const params = productQuerySchema.parse(raw);

    // Vendor's own inventory — visible regardless of store approval status.
    const mine = sp.get("mine") === "1" && (user?.role === "VENDOR" || user?.role === "ADMIN");
    if (mine) {
      if (user?.role === "VENDOR") {
        if (!user.store) return NextResponse.json({ items: [], total: 0 });
        const items = await db.product.findMany({
          where: { storeId: user.store.id },
          include: { store: { select: { id: true, name: true, slug: true, logoEmoji: true } } },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        return NextResponse.json({ items, total: items.length });
      }
    }

    const cacheKey = `products:${JSON.stringify(params)}`;

    const result = await cached(cacheKey, 10_000, async () => {
      const where: Prisma.ProductWhereInput = {
        store: { status: "ACTIVE" },
        ...(params.category ? { category: params.category } : {}),
        ...(params.minPriceCents !== undefined || params.maxPriceCents !== undefined
          ? {
              priceCents: {
                ...(params.minPriceCents !== undefined ? { gte: params.minPriceCents } : {}),
                ...(params.maxPriceCents !== undefined ? { lte: params.maxPriceCents } : {}),
              },
            }
          : {}),
        ...(params.featured ? { featured: true } : {}),
        ...(params.storeSlug ? { store: { status: "ACTIVE", slug: params.storeSlug } } : {}),
        ...(params.q
          ? {
              OR: [
                { name: { contains: params.q } },
                { tags: { contains: params.q } },
                { description: { contains: params.q } },
              ],
            }
          : {}),
      };

      let orderBy: Prisma.ProductOrderByWithRelationInput;
      switch (params.sort) {
        case "price-asc":
          orderBy = { priceCents: "asc" };
          break;
        case "price-desc":
          orderBy = { priceCents: "desc" };
          break;
        case "rating":
          orderBy = { rating: "desc" };
          break;
        case "newest":
          orderBy = { createdAt: "desc" };
          break;
        default:
          orderBy = { featured: "desc" };
      }

      const [items, total] = await Promise.all([
        db.product.findMany({
          where,
          orderBy,
          include: { store: { select: { id: true, name: true, slug: true, logoEmoji: true } } },
          take: params.limit,
          skip: params.offset,
        }),
        db.product.count({ where }),
      ]);
      return { items, total };
    });

    return NextResponse.json(result);
  }
);

/** POST /api/products — vendors create products for their own store; admins for any. */
export const POST = withApi(
  { rateLimit: { limit: 30, windowMs: 60_000 }, roles: ["VENDOR", "ADMIN"] },
  async (req, { user }) => {
    const input = await parseBody(req, productCreateSchema);
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in required.");

    let storeId: string;
    if (user.role === "ADMIN") {
      const slug = req.nextUrl.searchParams.get("storeSlug");
      if (!slug) throw new ApiError(422, "STORE_REQUIRED", "Admins must pass ?storeSlug= for the target store.");
      const store = await db.store.findUnique({ where: { slug } });
      if (!store) throw new ApiError(404, "STORE_NOT_FOUND", "No such store.");
      storeId = store.id;
    } else {
      if (!user.store) throw new ApiError(403, "NO_STORE", "Create your store first.");
      storeId = user.store.id;
    }

    const slug =
      input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 48) + `-${Math.random().toString(36).slice(2, 6)}`;

    const product = await db.product.create({
      data: {
        name: input.name,
        slug,
        description: input.description,
        priceCents: input.priceCents,
        compareAtPriceCents: input.compareAtPriceCents ?? null,
        imageUrl: input.imageUrl,
        category: input.category,
        tags: input.tags,
        stock: input.stock,
        featured: input.featured,
        storeId,
      },
      include: { store: { select: { id: true, name: true, slug: true, logoEmoji: true } } },
    });

    cacheInvalidatePrefix("products:");
    return NextResponse.json({ product }, { status: 201 });
  }
);
