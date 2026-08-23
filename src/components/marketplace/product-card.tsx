"use client";

import Image from "next/image";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { api, money, ApiClientError } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import type { Product } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Plus } from "lucide-react";

export function Stars({ rating, className = "" }: { rating: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} aria-label={`Rated ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`size-3.5 ${i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
          aria-hidden
        />
      ))}
    </span>
  );
}

export function ProductCard({ product, eager = false }: { product: Product; eager?: boolean }) {
  const navigate = useApp((s) => s.navigate);
  const setCartCount = useApp((s) => s.setCartCount);
  const queryClient = useQueryClient();
  const discount =
    product.compareAtPriceCents && product.compareAtPriceCents > product.priceCents
      ? Math.round(100 - (product.priceCents / product.compareAtPriceCents) * 100)
      : 0;

  const addToCart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const cart = await api<{ itemCount: number }>("/api/cart", {
        method: "POST",
        body: JSON.stringify({ productId: product.id, quantity: 1 }),
      });
      setCartCount(cart.itemCount);
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      toast.success("Added to cart", { description: product.name });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not add to cart.");
    }
  };

  return (
    <article
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card transition-all hover:shadow-lg hover:shadow-black/5 focus-within:ring-2 focus-within:ring-ring"
      onClick={() => navigate({ name: "product", id: product.id })}
      onKeyDown={(e) => e.key === "Enter" && navigate({ name: "product", id: product.id })}
      tabIndex={0}
      role="link"
      aria-label={`${product.name} by ${product.store.name}, ${money(product.priceCents)}`}
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        <Image
          src={product.imageUrl}
          alt={product.name}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
          loading={eager ? "eager" : "lazy"}
          priority={false}
          fetchPriority={eager ? "high" : "auto"}
        />
        {discount > 0 && (
          <Badge className="absolute left-2 top-2" variant="default">-{discount}%</Badge>
        )}
        {product.stock === 0 && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm font-semibold">
            Out of stock
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {product.store.logoEmoji} {product.store.name}
        </p>
        <h3 className="line-clamp-1 text-sm font-semibold">{product.name}</h3>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Stars rating={product.rating} />
          <span>({product.reviewCount})</span>
        </div>
        <div className="mt-auto flex items-center justify-between pt-1.5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold">{money(product.priceCents)}</span>
            {product.compareAtPriceCents && (
              <span className="text-xs text-muted-foreground line-through">{money(product.compareAtPriceCents)}</span>
            )}
          </div>
          <Button
            size="icon-sm"
            onClick={addToCart}
            disabled={product.stock === 0}
            aria-label={`Add ${product.name} to cart`}
            className="size-8"
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </article>
  );
}
