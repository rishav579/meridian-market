"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, money, ApiClientError } from "@/lib/client/api";
import { useRealtime } from "@/hooks/use-realtime";
import type { AdminStats, Order, Payout, RealtimeFeedItem, StoreRow } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DollarSign, Percent, Users, Store, Package, Wifi, WifiOff, Radio, Clock, BadgeCheck, Ban } from "lucide-react";

const statusVariant: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  PENDING: "outline", PAID: "secondary", PROCESSING: "secondary", SHIPPED: "default", DELIVERED: "default", CANCELLED: "destructive",
};

export function AdminDashboard() {
  const queryClient = useQueryClient();
  const [feed, setFeed] = useState<RealtimeFeedItem[]>([]);
  const [commissionStore, setCommissionStore] = useState<StoreRow | null>(null);
  const [commissionVal, setCommissionVal] = useState("10");

  const status = useRealtime({
    enabled: true,
    onEvent: (item) => {
      setFeed((f) => [item, ...f].slice(0, 30));
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api<AdminStats>("/api/admin/stats"),
  });
  const { data: storesData } = useQuery({
    queryKey: ["stores-admin"],
    queryFn: () => api<{ stores: StoreRow[] }>("/api/stores?all=1"),
  });
  const { data: ordersData } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<{ orders: Order[] }>("/api/orders"),
  });
  const { data: payoutsData } = useQuery({
    queryKey: ["payouts"],
    queryFn: () => api<{ payouts: Payout[] }>("/api/payouts"),
  });

  const setStoreStatus = async (store: StoreRow, next: "ACTIVE" | "SUSPENDED" | "PENDING") => {
    try {
      await api(`/api/stores/${store.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      toast.success(`${store.name} → ${next}`);
      queryClient.invalidateQueries({ queryKey: ["stores-admin"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Update failed.");
    }
  };

  const saveCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commissionStore) return;
    try {
      const rate = parseInt(commissionVal, 10) / 100;
      await api(`/api/stores/${commissionStore.id}`, { method: "PATCH", body: JSON.stringify({ commissionRate: rate }) });
      toast.success(`${commissionStore.name} commission set to ${commissionVal}%`);
      setCommissionStore(null);
      queryClient.invalidateQueries({ queryKey: ["stores-admin"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Update failed.");
    }
  };

  if (isLoading || !stats) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const kpis = [
    { icon: DollarSign, label: "GMV", value: money(stats.gmvCents), hint: `${stats.orderCount} orders` },
    { icon: Percent, label: "Platform revenue", value: money(stats.commissionCents), hint: "10% commission" },
    { icon: Users, label: "Users", value: String(stats.userCount), hint: `${stats.vendorCount} vendors` },
    { icon: Package, label: "Products", value: String(stats.productCount), hint: `${stats.pendingStoreCount} store(s) pending` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform overview</h1>
          <p className="text-sm text-muted-foreground">Marketplace health, vendor moderation and payout ledger</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {status === "connected" ? <Wifi className="size-3.5 text-primary" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
          {status === "connected" ? "Realtime on" : status === "connecting" ? "Connecting…" : "Realtime off"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">{k.label}</span>
              <k.icon className="size-4 text-primary" aria-hidden />
            </div>
            <p className="mt-1.5 text-xl font-bold">{k.value}</p>
            <p className="text-xs text-muted-foreground">{k.hint}</p>
          </div>
        ))}
      </div>

      {/* Order pipeline */}
      <div className="rounded-xl border p-4">
        <h2 className="mb-3 text-sm font-semibold">Order pipeline</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.byStatus).map(([st, count]) => (
            <span key={st} className="flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium">
              <Badge variant={statusVariant[st] ?? "outline"}>{st}</Badge> {count}
            </span>
          ))}
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
        <Tabs defaultValue="stores" className="space-y-4">
          <TabsList>
            <TabsTrigger value="stores">Stores</TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="payouts">Payouts</TabsTrigger>
          </TabsList>

          <TabsContent value="stores" className="space-y-3">
            <div className="overflow-hidden rounded-xl border">
              <div className="custom-scroll overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Store</th>
                      <th className="px-3 py-2.5 font-medium">Vendor</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Commission</th>
                      <th className="px-3 py-2.5 font-medium">Products</th>
                      <th className="px-3 py-2.5 font-medium">Revenue</th>
                      <th className="px-3 py-2.5" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(storesData?.stores ?? []).map((s) => {
                      const stat = stats.stores.find((x) => x.id === s.id);
                      return (
                        <tr key={s.id} className="hover:bg-muted/30">
                          <td className="px-4 py-2.5 font-medium">{s.logoEmoji} {s.name}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{s.vendor.name}</td>
                          <td className="px-3 py-2.5">
                            <Badge variant={s.status === "ACTIVE" ? "default" : s.status === "PENDING" ? "outline" : "destructive"}>{s.status}</Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              className="font-semibold text-primary underline-offset-4 hover:underline"
                              onClick={() => { setCommissionStore(s); setCommissionVal(String(Math.round((stat?.commissionRate ?? s.commissionRate) * 100))); }}
                              aria-label={`Edit commission for ${s.name}`}
                            >
                              {Math.round((stat?.commissionRate ?? s.commissionRate) * 100)}%
                            </button>
                          </td>
                          <td className="px-3 py-2.5">{stat?.productCount ?? s._count.products}</td>
                          <td className="px-3 py-2.5">{money(stat?.revenueCents ?? 0)}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex justify-end gap-1">
                              {s.status !== "ACTIVE" && (
                                <Button size="icon" variant="ghost" className="size-8 text-primary" onClick={() => setStoreStatus(s, "ACTIVE")} aria-label={`Approve ${s.name}`}>
                                  <BadgeCheck className="size-4" aria-hidden />
                                </Button>
                              )}
                              {s.status === "ACTIVE" && (
                                <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => setStoreStatus(s, "SUSPENDED")} aria-label={`Suspend ${s.name}`}>
                                  <Ban className="size-4" aria-hidden />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="orders" className="space-y-3">
            {(ordersData?.orders ?? []).length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">No orders yet.</div>
            ) : (
              <div className="overflow-hidden rounded-xl border">
                <div className="custom-scroll max-h-[28rem] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2.5 font-medium">Order</th>
                        <th className="px-3 py-2.5 font-medium">Customer</th>
                        <th className="px-3 py-2.5 font-medium">Total</th>
                        <th className="px-3 py-2.5 font-medium">Commission</th>
                        <th className="px-3 py-2.5 font-medium">Status</th>
                        <th className="px-3 py-2.5 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(ordersData?.orders ?? []).map((o) => (
                        <tr key={o.id} className="hover:bg-muted/30">
                          <td className="px-4 py-2.5 font-mono text-xs font-semibold">{o.orderNumber}</td>
                          <td className="px-3 py-2.5">{o.customerName}</td>
                          <td className="px-3 py-2.5 font-semibold">{money(o.total)}</td>
                          <td className="px-3 py-2.5 text-primary">{money(o.commissionTotal)}</td>
                          <td className="px-3 py-2.5"><Badge variant={statusVariant[o.status] ?? "outline"}>{o.status}</Badge></td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="payouts" className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {stats.payouts.map((p) => (
                <span key={p.status} className="rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium">
                  {p.status}: {p.count} · {money(p.amountCents)}
                </span>
              ))}
            </div>
            <div className="overflow-hidden rounded-xl border">
              <div className="custom-scroll max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Store</th>
                      <th className="px-3 py-2.5 font-medium">Order</th>
                      <th className="px-3 py-2.5 font-medium">Amount</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Transfer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(payoutsData?.payouts ?? []).map((p) => (
                      <tr key={p.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5"><Store className="mr-1.5 inline size-3.5 text-muted-foreground" aria-hidden />{p.store?.name ?? "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">{p.order?.orderNumber ?? "—"}</td>
                        <td className="px-3 py-2.5 font-semibold">{money(p.amount)}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant={p.status === "AVAILABLE" || p.status === "PAID" ? "default" : p.status === "REVERSED" ? "destructive" : "outline"}>{p.status}</Badge>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{p.transferId ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <aside className="space-y-3 rounded-xl border p-4" aria-label="Realtime activity">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Radio className="size-4 text-primary" aria-hidden /> Live activity
          </h2>
          {feed.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Placed orders and status changes stream here in real time.
            </p>
          ) : (
            <ScrollArea className="custom-scroll h-80">
              <ul className="space-y-2.5">
                {feed.map((f) => (
                  <li key={f.id} className="rounded-lg border bg-muted/30 p-2.5">
                    <p className="text-xs font-semibold">{f.label}</p>
                    <p className="text-xs text-muted-foreground">{f.detail}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="size-3" aria-hidden /> {new Date(f.at).toLocaleTimeString()}
                    </p>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </aside>
      </div>

      <Dialog open={Boolean(commissionStore)} onOpenChange={(v) => !v && setCommissionStore(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Commission — {commissionStore?.name}</DialogTitle>
            <DialogDescription>Platform share of each sale from this store (0–50%).</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveCommission} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="commission">Commission (%)</Label>
              <Input id="commission" type="number" min="0" max="50" step="1" value={commissionVal} onChange={(e) => setCommissionVal(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCommissionStore(null)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
