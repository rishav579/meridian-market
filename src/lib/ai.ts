/**
 * AI Shopping Assistant — retrieval-augmented product Q&A.
 *
 * Pipeline: budget/keyword extraction → scored catalog retrieval (SQLite, no
 * vector DB needed at this catalog size — cosine similarity over embeddings is
 * the documented upgrade path) → context-injected LLM call → persisted session.
 * Falls back to a deterministic recommender if the LLM is unavailable, so the
 * feature degrades gracefully instead of erroring.
 */

import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";

export interface RetrievedProduct {
  id: string;
  name: string;
  priceCents: number;
  category: string;
  storeName: string;
  imageUrl: string;
  rating: number;
  stock: number;
  slug: string;
}

interface ScoredProduct {
  product: RetrievedProduct;
  score: number;
}

// Retrieval

const STOP_WORDS = new Set([
  "show", "me", "find", "looking", "for", "the", "a", "an", "under", "over", "below", "above",
  "with", "and", "or", "to", "of", "in", "best", "good", "cheap", "budget", "some", "any",
  "want", "need", "get", "buy", "please", "can", "you", "i", "my", "gift", "about", "between",
]);

function extractBudgetCents(query: string): { max?: number; min?: number } {
  const under = query.match(/(?:under|below|less than|max(?:imum)? of?|up to)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i);
  const over = query.match(/(?:over|above|more than|min(?:imum)? of?)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i);
  const toCents = (s: string) => Math.round(parseFloat(s.replace(/,/g, "")) * 100);
  return {
    max: under ? toCents(under[1]) : undefined,
    min: over ? toCents(over[1]) : undefined,
  };
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

export async function retrieveCatalog(query: string, limit = 6): Promise<RetrievedProduct[]> {
  const budget = extractBudgetCents(query);
  const tokens = tokenize(query);

  const products = await db.product.findMany({
    where: { store: { status: "ACTIVE" }, stock: { gt: 0 } },
    include: { store: { select: { name: true } } },
    take: 200,
  });

  const scored: ScoredProduct[] = [];
  for (const p of products) {
    if (budget.max !== undefined && p.priceCents > budget.max) continue;
    if (budget.min !== undefined && p.priceCents < budget.min) continue;

    let score = 0;
    const name = p.name.toLowerCase();
    const tags = p.tags.toLowerCase();
    const cat = p.category.toLowerCase();
    const desc = p.description.toLowerCase();

    for (const token of tokens) {
      if (name.includes(token)) score += 5;
      if (tags.includes(token)) score += 3;
      if (cat.includes(token)) score += 3;
      if (desc.includes(token)) score += 1;
    }
    score += p.rating * 0.6 + (p.featured ? 1.5 : 0);

    scored.push({
      score,
      product: {
        id: p.id,
        name: p.name,
        priceCents: p.priceCents,
        category: p.category,
        storeName: p.store.name,
        imageUrl: p.imageUrl,
        rating: p.rating,
        stock: p.stock,
        slug: p.slug,
      },
    });
  }

  // Relevance first when the query is specific; rating carries vague queries.
  scored.sort((a, b) => b.score - a.score || b.product.rating - a.product.rating);
  return scored.slice(0, limit).map((s) => s.product);
}

// Prompt construction

function buildSystemPrompt(catalog: RetrievedProduct[]): string {
  const lines = catalog
    .map(
      (p) =>
        `- ${p.name} | ${formatCents(p.priceCents)} | ${p.category} | by ${p.storeName} | rating ${p.rating.toFixed(1)}/5 | ${p.stock} in stock | id:${p.id}`
    )
    .join("\n");

  return [
    "You are Aria, the shopping assistant for Meridian Market, a multi-vendor marketplace.",
    "Recommend ONLY products from the catalog below. Never invent products or prices.",
    "Rules:",
    "1. Start with a one-sentence answer to the shopper's question.",
    "2. Then list at most 3 recommendations as markdown bullets: **Name** — $price, store name, one short reason it fits.",
    "3. If nothing in the catalog fits (e.g. budget too low), say so honestly and suggest the closest alternative.",
    "4. Be concise (under 120 words), friendly, no emojis.",
    "",
    "Catalog:",
    lines || "(catalog is empty — apologize and suggest browsing categories)",
  ].join("\n");
}

// Fallback (deterministic, no LLM)

function fallbackReply(products: RetrievedProduct[]): string {
  if (products.length === 0) {
    return "I could not find a close match right now. Try browsing by category, or tell me a category and a budget (e.g. \"headphones under $150\").";
  }
  const bullets = products
    .slice(0, 3)
    .map((p) => `- **${p.name}** — ${formatCents(p.priceCents)}, ${p.storeName}`)
    .join("\n");
  return `Here are the top matches from our marketplace:\n\n${bullets}\n\nTap a card below to view details.`;
}

// Main entry

export interface AssistantReply {
  sessionId: string;
  reply: string;
  products: RetrievedProduct[];
  degraded: boolean;
}

export async function assistantChat(params: {
  sessionId?: string;
  userId: string | null;
  message: string;
}): Promise<AssistantReply> {
  // 1. Session continuity
  let session = params.sessionId
    ? await db.chatSession.findUnique({ where: { id: params.sessionId }, include: { messages: true } })
    : null;
  if (!session) {
    session = await db.chatSession.create({
      data: { userId: params.userId, messages: { create: { role: "user", content: params.message } } },
      include: { messages: true },
    });
  } else {
    await db.chatMessage.create({ data: { sessionId: session.id, role: "user", content: params.message } });
  }

  // 2. Retrieve + generate
  const products = await retrieveCatalog(params.message);
  let reply: string;
  let degraded = false;

  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();
    const history = session.messages.slice(-8).map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: buildSystemPrompt(products) },
        ...history,
        { role: "user", content: params.message },
      ],
      thinking: { type: "disabled" },
    });

    reply = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!reply) throw new Error("empty completion");
  } catch (err) {
    console.warn("[ai] LLM unavailable, using deterministic fallback:", (err as Error).message);
    reply = fallbackReply(products);
    degraded = true;
  }

  await db.chatMessage.create({ data: { sessionId: session.id, role: "assistant", content: reply } });

  return { sessionId: session.id, reply, products, degraded };
}
