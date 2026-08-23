import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, parseBody, ApiError } from "@/lib/api";
import { signupSchema } from "@/lib/validation";
import { hashPassword, createSession } from "@/lib/auth";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export const POST = withApi(
  { rateLimit: { limit: 10, windowMs: 60_000 } },
  async (req, { user }) => {
    if (user) throw new ApiError(409, "ALREADY_SIGNED_IN", "You are already signed in.");

    const input = await parseBody(req, signupSchema);
    const existing = await db.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists.");
    }

    const created = await db.$transaction(async (tx) => {
      const account = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash: hashPassword(input.password),
          role: input.role,
        },
      });

      if (input.role === "VENDOR") {
        if (!input.storeName) {
          throw new ApiError(422, "STORE_NAME_REQUIRED", "Vendors must provide a store name.");
        }
        let slug = slugify(input.storeName);
        const clash = await tx.store.findUnique({ where: { slug } });
        if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
        await tx.store.create({
          data: {
            name: input.storeName,
            slug,
            description: input.storeDescription ?? "",
            logoEmoji: "🏬",
            status: "PENDING", // admin approval required before products go public
            vendorId: account.id,
          },
        });
      }
      return account;
    });

    await createSession(created.id);

    const profile = await db.user.findUnique({
      where: { id: created.id },
      include: { store: true },
    });
    return NextResponse.json(
      {
        user: {
          id: created.id,
          email: created.email,
          name: created.name,
          role: created.role,
          store: profile?.store
            ? {
                id: profile.store.id,
                name: profile.store.name,
                slug: profile.store.slug,
                status: profile.store.status,
                commissionRate: profile.store.commissionRate,
              }
            : null,
        },
      },
      { status: 201 }
    );
  }
);
