"use client";

import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, money, ApiClientError } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import type { CartState } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Minus, Plus, ShoppingCart, Trash2, ArrowRight } from "lucide-react";

export function CartView() {
  const navigate = useApp((s) => s.navigate);
  const setCartCount = useApp((s) => s.setCartCount);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["cart"],
    queryFn: () => api<CartState>("/api/cart"),
  });

  const mutate = async (productId: string, quantity: number) => {
    try {
      const cart = await api<CartState>("/api/cart", {
        method: "PATCH",
        body: JSON.stringify({ productId, quantity }),
      });
      setCartCount(cart.itemCount);
      queryClient.setQueryData(["cart"], cart);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Update failed.");
    }
  };

  const remove = async (productId: string) => {
    try {
      const cart = await api<CartState>(`/api/cart?productId=${encodeURIComponent(productId)}`, { method: "DELETE" });
      setCartCount(cart.itemCount);
      queryClient.setQueryData(["cart"], cart);
      toast.success("Removed from cart");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Remove failed.");
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed py-20 text-center">
        <ShoppingCart className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Your cart is empty</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Browse the catalog or ask Aria for a personalized pick — items stay in your cart across visits.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => navigate({ name: "home" })}>Browse catalog</Button>
          <Button variant="outline" onClick={() => useApp.getState().openAssistant()}>Ask Aria</Button>
        </div>
      </div>
    );
  }

  // Group by store to preview the multi-vendor split
  const byStore = new Map<string, typeof items>();
  for (const item of items) {
    const list = byStore.get(item.store.name) ?? [];
    list.push(item);
    byStore.set(item.store.name, list);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Your cart</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {[...byStore.entries()].map(([storeName, storeItems]) => (
            <div key={storeName} className="rounded-xl border">
              <div className="border-b px-4 py-2.5 text-sm font-semibold">
                {storeItems[0]!.store.logoEmoji} {storeName}
                <span className="ml-2 font-normal text-muted-foreground">({storeItems.length} {storeItems.length === 1 ? "item" : "items"})</span>
              </div>
              <ul className="divide-y">
                {storeItems.map((item) => (
                  <li key={item.productId} className="flex items-center gap-4 p-4">
                    <button
                      className="relative size-16 shrink-0 overflow-hidden rounded-lg border bg-muted"
                      onClick={() => navigate({ name: "product", id: item.productId })}
                      aria-label={`View ${item.name}`}
                    >
                      <Image src={item.imageUrl} alt={item.name} fill sizes="64px" className="object-cover" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{money(item.unitPriceCents)} each</p>
                      <div className="mt-1.5 flex items-center gap-1">
                        <Button variant="outline" size="icon" className="size-7" onClick={() => mutate(item.productId, item.quantity - 1)} aria-label={`Decrease ${item.name} quantity`} disabled={item.quantity <= 1}>
                          <Minus className="size-3" aria-hidden />
                        </Button>
                        <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                        <Button variant="outline" size="icon" className="size-7" onClick={() => mutate(item.productId, item.quantity + 1)} aria-label={`Increase ${item.name} quantity`} disabled={item.quantity >= Math.min(item.stock, 20)}>
                          <Plus className="size-3" aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon" className="ml-1 size-7 text-muted-foreground hover:text-destructive" onClick={() => remove(item.productId)} aria-label={`Remove ${item.name}`}>
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm font-bold">{money(item.lineTotalCents)}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <aside className="sticky top-36 space-y-3 rounded-xl border p-5" aria-label="Order summary">
          <h2 className="font-semibold">Summary</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Items ({data?.itemCount ?? 0})</dt>
              <dd>{money(data?.subtotalCents ?? 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Shipping</dt>
              <dd className="text-primary font-medium">Free</dd>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-bold">
              <dt>Total</dt>
              <dd>{money(data?.subtotalCents ?? 0)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Multi-vendor orders are split automatically — each store is paid its share at checkout.
          </p>
          <Button className="w-full gap-1.5" size="lg" onClick={() => navigate({ name: "checkout" })}>
            Checkout <ArrowRight className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => navigate({ name: "home" })}>
            Continue shopping
          </Button>
        </aside>
      </div>
    </div>
  );
}
