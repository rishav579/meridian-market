import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, parseBody, ApiError } from "@/lib/api";
import { cartAddSchema, cartUpdateSchema } from "@/lib/validation";
import { resolveCart } from "@/lib/cart";

async function cartPayload(cartId: string) {
  const cart = await db.cart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        include: {
          product: { include: { store: { select: { name: true, slug: true, logoEmoji: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!cart) return { items: [], subtotalCents: 0, itemCount: 0 };

  const items = cart.items
    .filter((i) => i.product)
    .map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      unitPriceCents: i.unitPrice,
      lineTotalCents: i.unitPrice * i.quantity,
      name: i.product!.name,
      imageUrl: i.product!.imageUrl,
      slug: i.product!.slug,
      stock: i.product!.stock,
      store: i.product!.store,
    }));

  return {
    items,
    subtotalCents: items.reduce((sum, i) => sum + i.lineTotalCents, 0),
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
  };
}

export const GET = withApi(
  { rateLimit: { limit: 120, windowMs: 60_000 } },
  async (_req, { user }) => {
    const cartId = await resolveCart(user);
    return NextResponse.json(await cartPayload(cartId));
  }
);

/** POST /api/cart — add item (or increment). Price snapshotted server-side; never trusted from client. */
export const POST = withApi(
  { rateLimit: { limit: 90, windowMs: 60_000 } },
  async (req, { user }) => {
    const input = await parseBody(req, cartAddSchema);
    const product = await db.product.findUnique({ where: { id: input.productId }, include: { store: true } });
    if (!product || product.store.status !== "ACTIVE") {
      throw new ApiError(404, "NOT_FOUND", "Product not found.");
    }
    if (product.stock < 1) throw new ApiError(409, "OUT_OF_STOCK", "This item is out of stock.");

    const cartId = await resolveCart(user);
    const existing = await db.cartItem.findUnique({
      where: { cartId_productId: { cartId, productId: input.productId } },
    });
    const newQty = Math.min((existing?.quantity ?? 0) + input.quantity, Math.min(product.stock, 20));

    if (existing) {
      await db.cartItem.update({ where: { id: existing.id }, data: { quantity: newQty, unitPrice: product.priceCents } });
    } else {
      await db.cartItem.create({
        data: { cartId, productId: input.productId, quantity: newQty, unitPrice: product.priceCents },
      });
    }

    return NextResponse.json(await cartPayload(cartId));
  }
);

/** PATCH /api/cart — set quantity (0 removes). */
export const PATCH = withApi(
  { rateLimit: { limit: 90, windowMs: 60_000 } },
  async (req, { user }) => {
    const input = await parseBody(req, cartUpdateSchema);
    const cartId = await resolveCart(user);

    if (input.quantity === 0) {
      await db.cartItem.deleteMany({ where: { cartId, productId: input.productId } });
    } else {
      const item = await db.cartItem.findUnique({
        where: { cartId_productId: { cartId, productId: input.productId } },
        include: { product: true },
      });
      if (!item || !item.product) throw new ApiError(404, "NOT_FOUND", "Item not in cart.");
      const qty = Math.min(input.quantity, Math.min(item.product.stock, 20));
      await db.cartItem.update({ where: { id: item.id }, data: { quantity: qty, unitPrice: item.product.priceCents } });
    }

    return NextResponse.json(await cartPayload(cartId));
  }
);

/** DELETE /api/cart?productId=... — remove one item; no param clears the cart. */
export const DELETE = withApi(
  { rateLimit: { limit: 60, windowMs: 60_000 } },
  async (req, { user }) => {
    const cartId = await resolveCart(user);
    const productId = req.nextUrl.searchParams.get("productId");
    if (productId) {
      await db.cartItem.deleteMany({ where: { cartId, productId } });
    } else {
      await db.cartItem.deleteMany({ where: { cartId } });
    }
    return NextResponse.json(await cartPayload(cartId));
  }
);
