"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Markdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { api, money, ApiClientError } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import type { AssistantProduct, AssistantResult } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Sparkles, X, Send, Bot, User, TriangleAlert } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  products?: AssistantProduct[];
  degraded?: boolean;
}

const SUGGESTIONS = [
  "Running shoes under $100",
  "Best rated audio gear",
  "Cozy home gift ideas",
  "Something for my desk setup",
];

export function AiAssistant() {
  const open = useApp((s) => s.assistantOpen);
  const openAssistant = useApp((s) => s.openAssistant);
  const closeAssistant = useApp((s) => s.closeAssistant);
  const seed = useApp((s) => s.assistantSeed);
  const chatSessionId = useApp((s) => s.chatSessionId);
  const setChatSessionId = useApp((s) => s.setChatSessionId);
  const navigate = useApp((s) => s.navigate);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const seededRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: message };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    try {
      const res = await api<AssistantResult>("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message, sessionId: chatSessionId ?? undefined }),
      });
      setChatSessionId(res.sessionId);
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", content: res.reply, products: res.products, degraded: res.degraded },
      ]);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Aria is unavailable right now.");
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", content: "Sorry — I could not reach the assistant. Please try again." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // Deep-link seed from product page ("Ask Aria about this")
  useEffect(() => {
    if (open && seed && !seededRef.current) {
      seededRef.current = true;
      void send(seed);
      useApp.setState({ assistantSeed: null });
    }
    if (!open) seededRef.current = false;
  }, [open, seed]);

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <motion.button
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          onClick={() => openAssistant()}
          className="fixed bottom-5 right-5 z-50 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="Open AI shopping assistant"
        >
          <Sparkles className="size-6" aria-hidden />
        </motion.button>
      )}

      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-4 right-4 z-50 flex h-[min(34rem,85vh)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
            role="dialog"
            aria-label="Aria, AI shopping assistant"
          >
            <header className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4.5" aria-hidden />
                <div>
                  <p className="text-sm font-semibold leading-tight">Aria</p>
                  <p className="text-[11px] opacity-80">AI shopping assistant</p>
                </div>
              </div>
              <Button size="icon" variant="ghost" className="size-8 text-primary-foreground hover:bg-white/20 hover:text-primary-foreground" onClick={closeAssistant} aria-label="Close assistant">
                <X className="size-4" aria-hidden />
              </Button>
            </header>

            <ScrollArea className="custom-scroll flex-1 bg-muted/20">
              <div className="space-y-4 p-4">
                {messages.length === 0 && (
                  <div className="space-y-3 py-4 text-center">
                    <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10">
                      <Sparkles className="size-5 text-primary" aria-hidden />
                    </span>
                    <p className="text-sm font-medium">Hi! I can find products, compare prices and suggest gifts.</p>
                    <p className="text-xs text-muted-foreground">Try one of these:</p>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => void send(s)}
                          className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((m) => (
                  <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
                    {m.role === "assistant" && (
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Bot className="size-4 text-primary" aria-hidden />
                      </span>
                    )}
                    <div className={`max-w-[85%] space-y-2 ${m.role === "user" ? "order-first" : ""}`}>
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                          m.role === "user"
                            ? "rounded-br-sm bg-primary text-primary-foreground"
                            : "rounded-bl-sm border bg-background"
                        }`}
                      >
                        {m.role === "assistant" ? (
                          <div className="prose prose-sm max-w-none [&_li]:my-0.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
                            <Markdown>{m.content}</Markdown>
                          </div>
                        ) : (
                          <span className="flex items-start gap-1.5">
                            <User className="mt-0.5 size-3.5 shrink-0 opacity-70" aria-hidden />
                            {m.content}
                          </span>
                        )}
                      </div>
                      {m.degraded && (
                        <Badge variant="outline" className="text-[10px] text-amber-600">
                          <TriangleAlert className="mr-1 size-3" aria-hidden /> catalog fallback mode
                        </Badge>
                      )}
                      {m.products && m.products.length > 0 && (
                        <div className="custom-scroll flex gap-2 overflow-x-auto pb-1">
                          {m.products.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => navigate({ name: "product", id: p.id })}
                              className="w-28 shrink-0 overflow-hidden rounded-lg border bg-background text-left transition-shadow hover:shadow-md"
                              aria-label={`View ${p.name}`}
                            >
                              <div className="relative aspect-square bg-muted">
                                <Image src={p.imageUrl} alt={p.name} fill sizes="112px" className="object-cover" />
                              </div>
                              <div className="p-1.5">
                                <p className="line-clamp-1 text-[11px] font-semibold">{p.name}</p>
                                <p className="text-[11px] text-primary">{money(p.priceCents)}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {busy && (
                  <div className="flex gap-2">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="size-4 text-primary" aria-hidden />
                    </span>
                    <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm border bg-background px-4 py-3" aria-live="polite">
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:240ms]" />
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <form
              className="flex items-center gap-2 border-t p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about products, budgets, gifts…"
                maxLength={500}
                className="flex-1 rounded-full border bg-background px-4 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Message Aria"
              />
              <Button type="submit" size="icon" className="size-9 shrink-0 rounded-full" disabled={!input.trim() || busy} aria-label="Send message">
                <Send className="size-4" aria-hidden />
              </Button>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
