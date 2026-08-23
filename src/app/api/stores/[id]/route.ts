import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, parseBody, ApiError } from "@/lib/api";
import { storeAdminPatchSchema } from "@/lib/validation";
import { cacheInvalidatePrefix } from "@/lib/cache";
import { emitRealtime } from "@/lib/realtime";
import type { SessionUser } from "@/lib/auth";

interface Ctx {
  params: Promise<{ id: string }>;
  user: SessionUser | null;
}

/** PATCH /api/stores/:id — admin moderation: approve / suspend / set commission. */
export const PATCH = withApi<Ctx>(
  { rateLimit: { limit: 30, windowMs: 60_000 }, roles: ["ADMIN"] },
  async (req, { params }) => {
    const { id } = await params;
    const store = await db.store.findUnique({ where: { id }, include: { vendor: true } });
    if (!store) throw new ApiError(404, "NOT_FOUND", "Store not found.");

    const input = await parseBody(req, storeAdminPatchSchema);
    const updated = await db.store.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.commissionRate !== undefined ? { commissionRate: input.commissionRate } : {}),
      },
      include: { vendor: { select: { name: true } }, _count: { select: { products: true } } },
    });

    cacheInvalidatePrefix("products:");
    if (input.status) {
      await emitRealtime({
        event: "payout:update",
        rooms: [`store:${id}`, "admin"],
        payload: { storeId: id, storeName: store.name, status: input.status },
      }).catch(() => undefined);
    }

    return NextResponse.json({ store: updated });
  }
);
