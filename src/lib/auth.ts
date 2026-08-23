/**
 * Authentication & RBAC.
 *
 * Design: DB-backed opaque sessions (32-byte random token in an httpOnly,
 * SameSite=Lax cookie) + scrypt password hashing with per-user salt.
 * No third-party auth dependency → fully auditable, ~120 LOC, and the session
 * table doubles as a "sign out everywhere" primitive. The API surface is
 * intentionally shaped like Auth.js (`auth()`, `requireRole`) so migrating to
 * NextAuth Credentials/JWT later is a drop-in change.
 */

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TTL_DAYS, GUEST_CART_COOKIE, type Role } from "@/lib/constants";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  store: {
    id: string;
    name: string;
    slug: string;
    status: string;
    commissionRate: number;
  } | null;
}

// Passwords (scrypt, N=16327)

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, digest] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// Sessions

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { token, userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { token },
    include: {
      user: { include: { store: true } },
    },
  });
  if (!session || session.expiresAt < new Date()) {
    if (session) await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role as Role,
    store: session.user.store
      ? {
          id: session.user.store.id,
          name: session.user.store.name,
          slug: session.user.store.slug,
          status: session.user.store.status,
          commissionRate: session.user.store.commissionRate,
        }
      : null,
  };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { token } }).catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
}

// Guest identity (cart / chat continuity pre-login)

export async function getOrCreateGuestToken(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(GUEST_CART_COOKIE)?.value;
  if (existing) return existing;
  const token = randomBytes(18).toString("hex");
  jar.set(GUEST_CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return token;
}

export async function readGuestToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(GUEST_CART_COOKIE)?.value ?? null;
}

// Realtime tickets (short-lived HMAC, authorizes socket.io room joins)

export interface RealtimeTicket {
  sub: string;
  role: Role;
  storeId: string | null;
  exp: number;
}

export function issueRealtimeTicket(user: SessionUser): string {
  const payload: RealtimeTicket = {
    sub: user.id,
    role: user.role,
    storeId: user.store?.id ?? null,
    exp: Date.now() + 60_000, // 60s — enough to open the socket
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", process.env.AUTH_SECRET ?? "dev").update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyRealtimeTicket(ticket: string): RealtimeTicket | null {
  const [body, sig] = ticket.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", process.env.AUTH_SECRET ?? "dev").update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as RealtimeTicket;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
