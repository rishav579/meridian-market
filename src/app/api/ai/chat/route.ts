/**
 * POST /api/ai/chat — the AI Shopping Assistant.
 * RAG-lite: budget/keyword retrieval over the live catalog injected as LLM
 * context; full session persistence; deterministic fallback when the LLM is
 * unavailable (degraded flag exposed to the UI).
 */

import { NextRequest, NextResponse } from "next/server";
import { withApi, parseBody } from "@/lib/api";
import { chatSchema } from "@/lib/validation";
import { assistantChat } from "@/lib/ai";

export const POST = withApi(
  { rateLimit: { limit: 15, windowMs: 60_000 } },
  async (req, { user }) => {
    const input = await parseBody(req, chatSchema);
    const result = await assistantChat({
      sessionId: input.sessionId,
      userId: user?.id ?? null,
      message: input.message,
    });
    return NextResponse.json(result);
  }
);
