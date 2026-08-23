"use client";

/**
 * App store (Zustand): session, hash-synced SPA router, filters, dialog state.
 * The hash is the source of truth for the view so the browser back button and
 * deep links (#/product/<id>) work without Next.js routing.
 */

import { create } from "zustand";
import type { SessionUser } from "@/lib/client/types";

export type View =
  | { name: "home" }
  | { name: "product"; id: string }
  | { name: "cart" }
  | { name: "checkout" }
  | { name: "orders" }
  | { name: "dashboard" };

function viewToHash(view: View): string {
  switch (view.name) {
    case "home":
      return "#/";
    case "product":
      return `#/product/${view.id}`;
    default:
      return `#/${view.name}`;
  }
}

function hashToView(hash: string): View {
  const clean = hash.replace(/^#\/?/, "");
  const [seg, param] = clean.split("/");
  if (seg === "product" && param) return { name: "product", id: param };
  if (seg === "cart") return { name: "cart" };
  if (seg === "checkout") return { name: "checkout" };
  if (seg === "orders") return { name: "orders" };
  if (seg === "dashboard") return { name: "dashboard" };
  return { name: "home" };
}

interface AppState {
  // session
  user: SessionUser | null;
  authReady: boolean;
  setAuth: (user: SessionUser | null) => void;

  // router
  view: View;
  navigate: (view: View) => void;
  initRouter: () => void;

  // dialogs
  authOpen: boolean;
  authMode: "login" | "signup";
  openAuth: (mode?: "login" | "signup") => void;
  closeAuth: () => void;

  assistantOpen: boolean;
  assistantSeed: string | null;
  openAssistant: (seed?: string) => void;
  closeAssistant: () => void;
  chatSessionId: string | null;
  setChatSessionId: (id: string | null) => void;

  // cart badge
  cartCount: number;
  setCartCount: (n: number) => void;

  // catalog filters
  search: string;
  setSearch: (q: string) => void;
  category: string;
  setCategory: (c: string) => void;
  storeFilter: string | null;
  setStoreFilter: (slug: string | null) => void;
  sort: string;
  setSort: (s: string) => void;
}

let routerBound = false;

export const useApp = create<AppState>((set, get) => ({
  user: null,
  authReady: false,
  setAuth: (user) => set({ user }),

  view: { name: "home" },
  navigate: (view) => {
    const hash = viewToHash(view);
    if (window.location.hash !== hash) window.location.hash = hash;
    else set({ view });
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  },
  initRouter: () => {
    if (routerBound) return;
    routerBound = true;
    const apply = () => set({ view: hashToView(window.location.hash) });
    window.addEventListener("hashchange", apply);
    apply();
    void get();
  },

  authOpen: false,
  authMode: "login",
  openAuth: (mode) => set({ authOpen: true, authMode: mode ?? "login" }),
  closeAuth: () => set({ authOpen: false }),

  assistantOpen: false,
  assistantSeed: null,
  openAssistant: (seed) => set({ assistantOpen: true, assistantSeed: seed ?? null }),
  closeAssistant: () => set({ assistantOpen: false, assistantSeed: null }),
  chatSessionId: null,
  setChatSessionId: (id) => set({ chatSessionId: id }),

  cartCount: 0,
  setCartCount: (n) => set({ cartCount: n }),

  search: "",
  setSearch: (q) => set({ search: q }),
  category: "all",
  setCategory: (c) => set({ category: c }),
  storeFilter: null,
  setStoreFilter: (slug) => set({ storeFilter: slug }),
  sort: "relevance",
  setSort: (s) => set({ sort: s }),
}));
