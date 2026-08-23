import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withApi, parseBody, ApiError } from "@/lib/api";
import { loginSchema } from "@/lib/validation";
import { verifyPassword, createSession, type SessionUser } from "@/lib/auth";
import { mergeGuestCartIntoUser } from "@/lib/cart";

export const POST = withApi(
  { rateLimit: { limit: 10, windowMs: 60_000 } },
  async (req, { user }) => {
    if (user) throw new ApiError(409, "ALREADY_SIGNED_IN", "You are already signed in.");

    const input = await parseBody(req, loginSchema);
    const account = await db.user.findUnique({ where: { email: input.email }, include: { store: true } });
    if (!account || !verifyPassword(input.password, account.passwordHash)) {
      // Uniform message — no user-enumeration oracle.
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const sessionUser: SessionUser = {
      id: account.id,
      email: account.email,
      name: account.name,
      role: account.role as SessionUser["role"],
      store: account.store
        ? {
            id: account.store.id,
            name: account.store.name,
            slug: account.store.slug,
            status: account.store.status,
            commissionRate: account.store.commissionRate,
          }
        : null,
    };

    await createSession(account.id);
    await mergeGuestCartIntoUser(sessionUser);

    return NextResponse.json({ user: sessionUser });
  }
);
