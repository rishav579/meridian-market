"use client";

import { useState } from "react";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { api, money, ApiClientError } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import type { CartState, CheckoutResult } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CreditCard, Lock, CheckCircle2, Package, Store, ArrowRight } from "lucide-react";

interface FormState {
  shippingName: string;
  email: string;
  line1: string;
  city: string;
  state: string;
  postal: string;
  country: string;
}

export function CheckoutView() {
  const navigate = useApp((s) => s.navigate);
  const user = useApp((s) => s.user);
  const setCartCount = useApp((s) => s.setCartCount);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>({
    shippingName: user?.name ?? "",
    email: user?.email ?? "",
    line1: "",
    city: "",
    state: "",
    postal: "",
    country: "US",
  });
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["cart"],
    queryFn: () => api<CartState>("/api/cart"),
  });

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const valid =
    form.shippingName.trim().length > 0 &&
    /.+@.+\..+/.test(form.email) &&
    form.line1.trim().length > 0 &&
    form.city.trim().length > 0 &&
    form.postal.trim().length > 0;

  const placeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setPlacing(true);
    try {
      const res = await api<CheckoutResult>("/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          shippingName: form.shippingName,
          email: form.email,
          line1: form.line1,
          city: form.city,
          state: form.state,
          postal: form.postal,
          country: form.country,
        }),
      });
      setResult(res);
      setCartCount(0);
      queryClient.setQueryData(["cart"], { items: [], subtotalCents: 0, itemCount: 0 });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(`Order ${res.order.orderNumber} placed`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Checkout failed. Please try again.");
    } finally {
      setPlacing(false);
    }
  };

  // Success receipt
  if (result) {
    const o = result.order;
    return (
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto max-w-2xl space-y-6">
        <div className="flex flex-col items-center gap-2 pt-6 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="size-8 text-primary" aria-hidden />
          </span>
          <h1 className="text-2xl font-bold">Order confirmed</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono font-semibold">{o.orderNumber}</span> · {o.status === "PAID" ? "Payment captured" : "Payment processing"} ·
            receipt sent to {form.email}
          </p>
        </div>

        <div className="rounded-xl border">
          <ul className="divide-y">
            {o.items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 p-4">
                <div className="relative size-12 shrink-0 overflow-hidden rounded-md border bg-muted">
                  <Image src={it.imageUrl} alt={it.productName} fill sizes="48px" className="object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.productName}</p>
                  <p className="text-xs text-muted-foreground"><Store className="mr-0.5 inline size-3" aria-hidden />{it.storeName} · qty {it.quantity}</p>
                </div>
                <p className="text-sm font-semibold">{money(it.lineTotal)}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border bg-muted/30 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <CreditCard className="size-4 text-primary" aria-hidden /> How your payment was split
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Order total</dt><dd className="font-semibold">{money(o.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Marketplace fee (10%)</dt><dd>{money(o.commissionTotal)}</dd></div>
            {result.payment.transfers.map((t) => (
              <div key={t.transferId} className="flex justify-between">
                <dt className="text-muted-foreground">→ {t.storeName}</dt>
                <dd>{money(t.vendorEarningsCents)}</dd>
              </div>
            ))}
          </dl>
          <Separator className="my-3" />
          <p className="text-xs text-muted-foreground">
            Payment <span className="font-mono">{result.payment.intentId}</span> confirmed — each vendor has been paid their share.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {user ? (
            <Button onClick={() => navigate({ name: "orders" })} className="gap-1.5">
              <Package className="size-4" aria-hidden /> Track order
            </Button>
          ) : (
            <Badge variant="secondary" className="px-3 py-1.5">Guest order — sign in to track future orders</Badge>
          )}
          <Button variant="outline" onClick={() => navigate({ name: "home" })}>Continue shopping</Button>
        </div>
      </motion.div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-20 text-center">
        <p className="font-medium">Nothing to check out</p>
        <Button onClick={() => navigate({ name: "home" })}>Browse catalog</Button>
      </div>
    );
  }

  const byStore = new Map<string, number>();
  for (const item of data.items) byStore.set(item.store.name, (byStore.get(item.store.name) ?? 0) + item.lineTotalCents);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ name: "cart" })}>← Cart</Button>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>

      <form onSubmit={placeOrder} className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5 rounded-xl border p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Lock className="size-4 text-primary" aria-hidden /> Shipping details {user ? "" : "(guest checkout — no account needed)"}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="co-name">Full name</Label>
              <Input id="co-name" required maxLength={80} value={form.shippingName} onChange={set("shippingName")} autoComplete="name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="co-email">Email</Label>
              <Input id="co-email" type="email" required maxLength={160} value={form.email} onChange={set("email")} autoComplete="email" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="co-line1">Address</Label>
              <Input id="co-line1" required maxLength={160} value={form.line1} onChange={set("line1")} autoComplete="address-line1" placeholder="Street and number" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="co-city">City</Label>
              <Input id="co-city" required maxLength={80} value={form.city} onChange={set("city")} autoComplete="address-level2" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="co-state">State</Label>
                <Input id="co-state" maxLength={80} value={form.state} onChange={set("state")} autoComplete="address-level1" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="co-postal">Postal code</Label>
                <Input id="co-postal" required maxLength={20} value={form.postal} onChange={set("postal")} autoComplete="postal-code" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="co-country">Country (2-letter)</Label>
              <Input id="co-country" required maxLength={2} value={form.country} onChange={set("country")} autoComplete="country" className="uppercase" />
            </div>
          </div>
        </div>

        <aside className="space-y-4 rounded-xl border p-5" aria-label="Payment summary">
          <h2 className="font-semibold">Order summary</h2>
          <ul className="space-y-2.5">
            {data.items.map((i) => (
              <li key={i.productId} className="flex items-center gap-3">
                <div className="relative size-11 shrink-0 overflow-hidden rounded-md border bg-muted">
                  <Image src={i.imageUrl} alt={i.name} fill sizes="44px" className="object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{i.name}</p>
                  <p className="text-xs text-muted-foreground">×{i.quantity} · {i.store.name}</p>
                </div>
                <p className="text-sm font-semibold">{money(i.lineTotalCents)}</p>
              </li>
            ))}
          </ul>
          <Separator />
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd>{money(data.subtotalCents)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd className="font-medium text-primary">Free</dd></div>
            <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd>{money(data.subtotalCents)}</dd></div>
          </dl>
          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            Split across {[...byStore.keys()].length} vendor{byStore.size === 1 ? "" : "s"}: {[...byStore.entries()].map(([s, v]) => `${s} ${money(v)}`).join(" · ")}
          </div>
          <Button type="submit" className="w-full gap-2" size="lg" disabled={!valid || placing}>
            <CreditCard className="size-4.5" aria-hidden />
            {placing ? "Processing payment…" : `Pay ${money(data.subtotalCents)}`}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Vendors are paid their share of this order directly — no waiting, no middlemen.
          </p>
        </aside>
      </form>
    </div>
  );
}
