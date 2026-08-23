"use client";

import { useMemo } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { api, money } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import type { Product, StoreRow } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductCard } from "@/components/marketplace/product-card";
import { Sparkles, Store, X, SearchX, ShieldCheck, Truck, CreditCard } from "lucide-react";

interface ProductsResponse {
  items: Product[];
  total: number;
}

export function HomeView() {
  const { search, setSearch, category, setCategory, storeFilter, setStoreFilter, sort, setSort, navigate, openAssistant } = useApp();

  const params = useMemo(() => {
    const sp = new URLSearchParams();
    if (search.trim()) sp.set("q", search.trim());
    if (category !== "all") sp.set("category", category);
    if (storeFilter) sp.set("storeSlug", storeFilter);
    sp.set("sort", sort);
    sp.set("limit", "36");
    return sp.toString();
  }, [search, category, storeFilter, sort]);

  const { data, isLoading } = useQuery({
    queryKey: ["products", params],
    queryFn: () => api<ProductsResponse>(`/api/products?${params}`),
  });

  const { data: storesData } = useQuery({
    queryKey: ["stores"],
    queryFn: () => api<{ stores: StoreRow[] }>("/api/stores"),
  });

  const products = data?.items ?? [];
  const hasFilters = search.trim() !== "" || category !== "all" || storeFilter !== null || sort !== "relevance";

  return (
    <div className="space-y-10">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      {!hasFilters && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="grid items-center gap-6 overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-50 via-stone-50 to-amber-50/60 p-6 sm:p-10 md:grid-cols-2 dark:from-emerald-950/40 dark:via-stone-950 dark:to-stone-950"
        >
          <div className="space-y-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="size-3.5" aria-hidden /> AI-assisted shopping
            </span>
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              Four curated vendors. <span className="text-primary">One honest marketplace.</span>
            </h1>
            <p className="max-w-md text-muted-foreground">
              Every purchase is split transparently — vendors keep 90%, the platform takes 10%.
              Ask Aria, our AI assistant, to find exactly what you need.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Button onClick={() => openAssistant()} className="gap-1.5">
                <Sparkles className="size-4" aria-hidden /> Ask Aria
              </Button>
              <Button
                variant="outline"
                onClick={() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" })}
              >
                Browse catalog
              </Button>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <li className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-primary" aria-hidden /> Signed split payments</li>
              <li className="flex items-center gap-1.5"><Truck className="size-3.5 text-primary" aria-hidden /> Free shipping</li>
              <li className="flex items-center gap-1.5"><CreditCard className="size-3.5 text-primary" aria-hidden /> Guest checkout</li>
            </ul>
          </div>
          <div className="relative aspect-[2/1] w-full overflow-hidden rounded-xl border shadow-sm md:aspect-auto md:h-64 lg:h-72">
            <Image
              src="/images/hero-marketplace.jpg"
              alt="A flat-lay of curated marketplace products: sneakers, headphones, ceramics and a desk lamp"
              fill
              priority
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        </motion.section>
      )}

      {/* ── Storefronts ──────────────────────────────────────────────────── */}
      {!hasFilters && storesData && (
        <section aria-label="Featured storefronts">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Storefronts</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {storesData.stores.map((s) => (
              <button
                key={s.id}
                onClick={() => setStoreFilter(s.slug)}
                className="group flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xl" aria-hidden>
                  {s.logoEmoji}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">{s._count.products} products</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Catalog ──────────────────────────────────────────────────────── */}
      <section id="catalog" aria-label="Product catalog" className="scroll-mt-32 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {storeFilter ? `Store: ${storesData?.stores.find((s) => s.slug === storeFilter)?.name ?? storeFilter}` : category === "all" ? "All products" : category}
            {data && <span className="ml-2 text-sm font-normal text-muted-foreground">{data.total} items</span>}
          </h2>
          <div className="flex items-center gap-2">
            {storeFilter && (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setStoreFilter(null)}>
                <X className="size-3.5" aria-hidden /> Clear store
              </Button>
            )}
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger size="sm" className="w-40" aria-label="Sort products">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="relevance">Featured</SelectItem>
                <SelectItem value="price-asc">Price: low → high</SelectItem>
                <SelectItem value="price-desc">Price: high → low</SelectItem>
                <SelectItem value="rating">Top rated</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="aspect-square w-full rounded-xl" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
            <SearchX className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">No products match your filters</p>
            <p className="text-sm text-muted-foreground">Try another category, or ask Aria for ideas.</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setSearch(""); setCategory("all"); setStoreFilter(null); }}>
                Reset filters
              </Button>
              <Button size="sm" onClick={() => openAssistant()}>Ask Aria</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.3) }}
              >
                <ProductCard product={p} eager={i < 4} />
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* Vendor CTA */}
      {!hasFilters && (
        <section className="flex flex-col items-center gap-3 rounded-2xl border bg-muted/40 p-8 text-center">
          <Store className="size-7 text-primary" aria-hidden />
          <h2 className="text-lg font-semibold">Sell on Meridian</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Launch a storefront in minutes. Keep 90% of every sale — the platform commission is 10%, always.
            Orders stream to your dashboard in real time.
          </p>
          <Button variant="outline" onClick={() => useApp.getState().openAuth("signup")}>
            Become a vendor
          </Button>
        </section>
      )}
      <span className="sr-only">Catalog section</span>
    </div>
  );
}
