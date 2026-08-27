import { vi } from "vitest";

/**
 * Mocks `next/headers` cookies() so real route handlers (which read/write the
 * session, guest-cart and CSRF cookies) can run outside a Next.js request
 * scope. The jar is per-test-file and controlled by the exported helpers.
 */
const jar = new Map<string, { value: string }>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const entry = jar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    getAll: () =>
      [...jar.entries()].map(([name, entry]) => ({ name, value: entry.value })),
    set: (name: string, value: string) => {
      // app calls jar.set(name, value, options) — options are irrelevant here
      if (typeof name === "string") jar.set(name, { value: String(value) });
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  })),
}));

export function setCookie(name: string, value: string): void {
  jar.set(name, { value });
}

export function getCookie(name: string): string | undefined {
  return jar.get(name)?.value;
}

export function clearCookies(): void {
  jar.clear();
}
