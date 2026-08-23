/**
 * Shared cart resolution: authenticated users get a DB cart keyed by userId;
 * guests get one keyed by an httpOnly guest token cookie. On login the guest
 * cart is merged (quantities summed, capped to stock) and the guest row is
 * deleted — the "persistent cart" feature.
 */

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getOrCreateGuestToken, readGuestToken, type SessionUser } from "@/lib/auth";
import { ApiError } from "@/lib/api";

export async function resolveCart(user: SessionUser | null): Promise<string> {
  if (user) {
    let cart = await db.cart.findUnique({ where: { userId: user.id } });
    if (!cart) {
      cart = await db.cart.create({ data: { userId: user.id } });
    }
    return cart.id;
  }
  const guestToken = await getOrCreateGuestToken();
  let cart = await db.cart.findUnique({ where: { guestToken } });
  if (!cart) {
    cart = await db.cart.create({ data: { guestToken } });
  }
  return cart.id;
}

export async function mergeGuestCartIntoUser(user: SessionUser): Promise<void> {
  const jar = await cookies();
  const guestToken = await readGuestToken();
  if (!guestToken) return;

  const guestCart = await db.cart.findUnique({ where: { guestToken }, include: { items: true } });
  if (!guestCart || guestCart.items.length === 0) {
    if (guestCart) await db.cart.delete({ where: { id: guestCart.id } }).catch(() => undefined);
    return;
  }

  const userCartId = await resolveCart(user);

  await db.$transaction(async (tx) => {
    for (const item of guestCart.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) continue;
      const existing = await tx.cartItem.findUnique({
        where: { cartId_productId: { cartId: userCartId, productId: item.productId } },
      });
      const qty = Math.min(
        (existing?.quantity ?? 0) + item.quantity,
        Math.max(product.stock, 0) || (existing?.quantity ?? 0) + item.quantity
      );
      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: Math.min(qty, 20), unitPrice: product.priceCents },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: userCartId,
            productId: item.productId,
            quantity: Math.min(qty, 20),
            unitPrice: product.priceCents,
          },
        });
      }
    }
    await tx.cart.delete({ where: { id: guestCart.id } }).catch(() => undefined);
  });

  jar.delete("mk_guest_cart");
}

export async function requireCartStock(cartId: string): Promise<void> {
  const items = await db.cartItem.findMany({ where: { cartId }, include: { product: true } });
  for (const item of items) {
    if (!item.product || item.quantity > item.product.stock) {
      throw new ApiError(409, "INSUFFICIENT_STOCK", `Only ${item.product?.stock ?? 0} left of ${item.product?.name ?? "an item"}.`);
    }
  }
}
