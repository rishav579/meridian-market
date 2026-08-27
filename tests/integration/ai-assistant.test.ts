import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { assistantChat, retrieveCatalog } from "@/lib/ai";
import { makeProduct, makeStore, makeUser, resetDb } from "../helpers/test-utils";

// The LLM provider is a proprietary sandbox SDK that needs platform
// credentials. Mocking its failure path exercises the REAL deterministic
// fallback branch inside ai.ts without any external service.
vi.mock("z-ai-web-dev-sdk", () => ({
  default: {
    create: async () => {
      throw new Error("z.ai credentials unavailable in tests");
    },
  },
}));

interface Fixture {
  auroraId: string;
  lampDeskId: string;
  lampClipId: string;
  monitorId: string;
  ghostId: string;
}

async function seedCatalog(): Promise<Fixture> {
  const vendorA = await makeUser({ role: "VENDOR" });
  const vendorB = await makeUser({ role: "VENDOR" });
  const vendorPending = await makeUser({ role: "VENDOR" });
  const storeA = await makeStore(vendorA.id, { name: "Nordic Audio Lab" });
  const storeB = await makeStore(vendorB.id, { name: "Terra Home Goods" });
  const storePending = await makeStore(vendorPending.id, { status: "PENDING", name: "Ghost Goods" });

  const aurora = await makeProduct(storeA.id, {
    name: "Aurora Wireless Headphones",
    tags: "wireless bluetooth anc headphones music",
    priceCents: 19_999,
    rating: 4.5,
    stock: 5,
  });
  const lampDesk = await makeProduct(storeB.id, {
    name: "Nordic Desk Lamp",
    description: "Warm light for desks; pairs nicely with wireless headphones at night.",
    tags: "lamp desk lighting home",
    priceCents: 8_999,
    rating: 5.0,
    stock: 3,
  });
  const lampClip = await makeProduct(storeB.id, {
    name: "Budget Clip Lamp",
    tags: "lamp clip cheap reading light",
    priceCents: 4_999,
    rating: 3.0,
    stock: 10,
  });
  const monitor = await makeProduct(storeA.id, {
    name: "Pro Studio Monitor Speaker",
    tags: "audio studio monitor speakers production",
    priceCents: 29_999,
    rating: 4.0,
    stock: 2,
  });
  // lives on a PENDING store — must never surface anywhere
  const ghost = await makeProduct(storePending.id, {
    name: "Zebra Ghost Item",
    tags: "zebra exclusive unreleased",
    priceCents: 12_345,
    rating: 5.0,
    stock: 50,
  });

  return {
    auroraId: aurora.id,
    lampDeskId: lampDesk.id,
    lampClipId: lampClip.id,
    monitorId: monitor.id,
    ghostId: ghost.id,
  };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(() => db.$disconnect());

describe("catalog retrieval (real ai.ts over real Prisma data)", () => {
  it("applies an 'under $X' budget filter from natural language", async () => {
    const fx = await seedCatalog();
    const results = await retrieveCatalog("desk lamp under $120");
    const ids = results.map((r) => r.id);

    expect(ids).toContain(fx.lampDeskId);
    expect(ids).toContain(fx.lampClipId);
    expect(ids).not.toContain(fx.auroraId); // $199.99 exceeds the budget
    expect(ids).not.toContain(fx.ghostId);
  });

  it("applies an 'over $X' budget filter from natural language", async () => {
    const fx = await seedCatalog();
    const results = await retrieveCatalog("studio monitor speaker over $200");
    expect(results.map((r) => r.id)).toEqual([fx.monitorId]);
  });

  it("ranks direct name matches above indirect description mentions", async () => {
    const fx = await seedCatalog();
    const results = await retrieveCatalog("wireless headphones");
    // Aurora has both tokens in the name; the lamp only mentions them in the description
    expect(results[0]?.id).toBe(fx.auroraId);
    expect(results.map((r) => r.id)).toContain(fx.lampDeskId);
  });

  it("only retrieves products from ACTIVE stores with stock", async () => {
    const fx = await seedCatalog();
    const results = await retrieveCatalog("zebra"); // matches ONLY the pending-store product
    expect(results).not.toHaveLength(0);
    expect(results.map((r) => r.id)).not.toContain(fx.ghostId);
  });

  it("falls back to catalog-wide rating ranking when nothing matches", async () => {
    const fx = await seedCatalog();
    const results = await retrieveCatalog("qqqzzz vvvttt flibbertigibbet");

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(6);
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain(fx.ghostId);

    const ratings = results.map((r) => r.rating);
    const sorted = [...ratings].sort((a, b) => b - a);
    expect(ratings).toEqual(sorted); // deterministic rating-desc fallback ordering

    for (const r of results) {
      expect(r.stock).toBeGreaterThan(0);
      expect([fx.auroraId, fx.lampDeskId, fx.lampClipId, fx.monitorId]).toContain(r.id);
    }
  });
});

describe("assistant chat (real ai.ts, provider forced offline)", () => {
  it("degrades gracefully with a deterministic catalog-backed reply", async () => {
    await seedCatalog();
    const result = await assistantChat({
      userId: null,
      message: "good wireless headphones under $250",
    });

    expect(result.degraded).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(result.reply).toContain("Here are the top matches");
    expect(result.products.length).toBeGreaterThan(0);
    // recommendations are grounded in retrieved catalog rows, never invented
    const retrievedIds = new Set(result.products.map((p) => p.id));
    expect(retrievedIds.has((await db.product.findFirstOrThrow({ where: { name: "Aurora Wireless Headphones" } })).id)).toBe(true);
  });

  it("suggests browsing when the catalog cannot satisfy the request", async () => {
    await seedCatalog();
    const result = await assistantChat({
      userId: null,
      message: "a solid gold yacht anchor under $1 please",
    });
    expect(result.degraded).toBe(true);
    // budget floor excludes everything → honest "could not find" copy
    expect(result.reply).toContain("could not find");
  });

  it("persists full chat history across turns keyed by sessionId", async () => {
    await seedCatalog();

    const first = await assistantChat({ userId: null, message: "show me lamps" });
    expect(first.sessionId).toBeTruthy();

    const second = await assistantChat({
      sessionId: first.sessionId,
      userId: null,
      message: "cheaper please",
    });
    expect(second.sessionId).toBe(first.sessionId);

    const messages = await db.chatMessage.findMany({
      where: { sessionId: first.sessionId },
      orderBy: { createdAt: "asc" },
    });
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[0].content).toBe("show me lamps");
    expect(messages[2].content).toBe("cheaper please");
    expect(messages[3].content).toBe(second.reply);
  });

  it("attaches guest chats to the calling user id when signed in", async () => {
    await seedCatalog();
    const customer = await db.user.create({
      data: {
        email: "chatter@test.local",
        name: "Chatter",
        passwordHash: "scrypt:x:y",
        role: "CUSTOMER",
      },
    });
    const result = await assistantChat({ userId: customer.id, message: "any deals?" });
    const session = await db.chatSession.findUniqueOrThrow({ where: { id: result.sessionId } });
    expect(session.userId).toBe(customer.id);
  });
});
