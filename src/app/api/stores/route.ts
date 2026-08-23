import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, parseBody, ApiError } from "@/lib/api";
import { storeCreateSchema } from "@/lib/validation";

/** GET /api/stores — public directory of ACTIVE stores (admins see all with ?all=1). */
export const GET = withApi(
  { rateLimit: { limit: 60, windowMs: 60_000 } },
  async (req, { user }) => {
    const showAll = req.nextUrl.searchParams.get("all") === "1" && user?.role === "ADMIN";
    const stores = await db.store.findMany({
      where: showAll ? {} : { status: "ACTIVE" },
      include: {
        vendor: { select: { name: true } },
        _count: { select: { products: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ stores });
  }
);

/** POST /api/stores — a CUSTOMER-turned vendor without a store, or vendor recreating. */
export const POST = withApi(
  { rateLimit: { limit: 10, windowMs: 60_000 }, roles: ["VENDOR"] },
  async (req, { user }) => {
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in required.");
    if (user.store) throw new ApiError(409, "STORE_EXISTS", "You already manage a store.");

    const input = await parseBody(req, storeCreateSchema);
    let slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48);
    const clash = await db.store.findUnique({ where: { slug } });
    if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

    const store = await db.store.create({
      data: {
        name: input.name,
        slug,
        description: input.description,
        logoEmoji: input.logoEmoji,
        status: "PENDING",
        vendorId: user.id,
      },
      include: { vendor: { select: { name: true } }, _count: { select: { products: true } } },
    });
    return NextResponse.json({ store }, { status: 201 });
  }
);
