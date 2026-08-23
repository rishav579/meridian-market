"use client";

import Image from "next/image";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { api, money, ApiClientError } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import type { Product } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Stars } from "@/components/marketplace/product-card";
import { ProductCard } from "@/components/marketplace/product-card";
import { Minus, Plus, ShoppingCart, ArrowLeft, Sparkles, ShieldCheck } from "lucide-react";

export function ProductView({ id }: { id: string }) {
  const navigate = useApp((s) => s.navigate);
  const setCartCount = useApp((s) => s.setCartCount);
  const openAssistant = useApp((s) => s.openAssistant);
  const queryClient = useQueryClient();
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["product", id],
    queryFn: () => api<{ product: Product }>(`/api/products/${id}`),
  });

  const { data: related } = useQuery({
    queryKey: ["products", `related-${data?.product.category ?? ""}`],
    queryFn: () =>
      api<{ items: Product[] }>(`/api/products?category=${encodeURIComponent(data!.product.category)}&limit=8&sort=rating`),
    enabled: Boolean(data?.product.category),
  });

  if (isLoading) {
    return (
      <div className="grid gap-8 md:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-2xl" />
        <div className="space-y-4">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-48" />
        </div>
      </div>
    );
  }

  if (isError || !data?.product) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <p className="font-medium">This product is no longer available.</p>
        <Button variant="outline" onClick={() => navigate({ name: "home" })}>
          <ArrowLeft className="mr-2 size-4" aria-hidden /> Back to catalog
        </Button>
      </div>
    );
  }

  const p = data.product;
  const discount =
    p.compareAtPriceCents && p.compareAtPriceCents > p.priceCents
      ? Math.round(100 - (p.priceCents / p.compareAtPriceCents) * 100)
      : 0;

  const addToCart = async () => {
    setAdding(true);
    try {
      const cart = await api<{ itemCount: number }>("/api/cart", {
        method: "POST",
        body: JSON.stringify({ productId: p.id, quantity: qty }),
      });
      setCartCount(cart.itemCount);
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      toast.success("Added to cart", { description: `${qty} × ${p.name}` });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not add to cart.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
      <button
        onClick={() => navigate({ name: "home" })}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> All products
      </button>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="relative aspect-square overflow-hidden rounded-2xl border bg-muted">
          <Image
            src={p.imageUrl}
            alt={p.name}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
          />
          {discount > 0 && <Badge className="absolute left-3 top-3" variant="default">Save {discount}%</Badge>}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{p.category}</Badge>
            <button
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                useApp.getState().setStoreFilter(p.store.slug);
                navigate({ name: "home" });
              }}
            >
              {p.store.logoEmoji} {p.store.name}
            </button>
          </div>

          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{p.name}</h1>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Stars rating={p.rating} />
            <span>{p.rating.toFixed(1)} · {p.reviewCount} reviews</span>
          </div>

          <div className="flex items-baseline gap-2.5">
            <span className="text-3xl font-bold">{money(p.priceCents)}</span>
            {p.compareAtPriceCents && (
              <span className="text-base text-muted-foreground line-through">{money(p.compareAtPriceCents)}</span>
            )}
          </div>

          <p className="leading-relaxed text-muted-foreground">{p.description}</p>

          <p className="text-sm">
            {p.stock > 10 ? (
              <span className="text-primary font-medium">In stock — ships in 48h</span>
            ) : p.stock > 0 ? (
              <span className="font-medium text-amber-600">Only {p.stock} left</span>
            ) : (
              <span className="font-medium text-destructive">Out of stock</span>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-lg border" role="group" aria-label="Quantity">
              <Button variant="ghost" size="icon" className="size-10" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity" disabled={qty <= 1}>
                <Minus className="size-4" aria-hidden />
              </Button>
              <span className="w-10 text-center text-sm font-semibold" aria-live="polite">{qty}</span>
              <Button variant="ghost" size="icon" className="size-10" onClick={() => setQty((q) => Math.min(Math.min(p.stock, 20), q + 1))} aria-label="Increase quantity" disabled={qty >= Math.min(p.stock, 20)}>
                <Plus className="size-4" aria-hidden />
              </Button>
            </div>
            <Button className="flex-1 gap-2 sm:flex-none sm:px-8" size="lg" onClick={addToCart} disabled={p.stock === 0 || adding}>
              <ShoppingCart className="size-4.5" aria-hidden />
              {adding ? "Adding…" : "Add to cart"}
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="gap-2"
              onClick={() => openAssistant(`Tell me about ${p.name} — is it right for me?`)}
            >
              <Sparkles className="size-4 text-primary" aria-hidden /> Ask Aria
            </Button>
          </div>

          <div className="mt-2 flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              Split payment: {p.store.name} receives {money(Math.round(p.priceCents * 0.9))} (90%), Meridian platform
              commission {money(Math.round(p.priceCents * 0.1))} (10%) — computed per store rate at checkout.
            </span>
          </div>
        </div>
      </div>

      {related && related.items.filter((r) => r.id !== p.id).length > 0 && (
        <section aria-label="Related products" className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">More in {p.category}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {related.items
              .filter((r) => r.id !== p.id)
              .slice(0, 4)
              .map((r) => (
                <ProductCard key={r.id} product={r} />
              ))}
          </div>
        </section>
      )}
    </motion.div>
  );
}
