"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, money, ApiClientError } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { useRealtime } from "@/hooks/use-realtime";
import type { Order, OrderStatus, Payout, Product, RealtimeFeedItem } from "@/lib/client/types";
import { OrderTimeline } from "@/components/marketplace/views/orders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { DollarSign, Package, ShoppingCart, TrendingUp, Plus, Pencil, Trash2, Wifi, WifiOff, Clock, Radio } from "lucide-react";

const CATEGORIES = ["Footwear", "Apparel", "Fitness", "Audio", "Home & Kitchen", "Tech Accessories"];
const statusVariant: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  PENDING: "outline", PAID: "secondary", PROCESSING: "secondary", SHIPPED: "default", DELIVERED: "default", CANCELLED: "destructive",
};

const NEXT_ACTION: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  PAID: { to: "PROCESSING", label: "Start preparing" },
  PROCESSING: { to: "SHIPPED", label: "Mark shipped" },
  SHIPPED: { to: "DELIVERED", label: "Mark delivered" },
};

interface ProductForm {
  name: string;
  description: string;
  price: string; // dollars
  compareAt: string;
  imageUrl: string;
  category: string;
  tags: string;
  stock: string;
  featured: boolean;
}

const emptyForm: ProductForm = { name: "", description: "", price: "", compareAt: "", imageUrl: "", category: "Footwear", tags: "", stock: "10", featured: false };

export function VendorDashboard() {
  const user = useApp((s) => s.user);
  const queryClient = useQueryClient();
  const [feed, setFeed] = useState<RealtimeFeedItem[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const status = useRealtime({
    enabled: true,
    onEvent: (item) => {
      setFeed((f) => [item, ...f].slice(0, 30));
      if (item.event !== "payout:update") {
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        queryClient.invalidateQueries({ queryKey: ["vendor-products"] });
        toast.info(item.label, { description: item.detail });
      }
      if (item.event === "payout:update") queryClient.invalidateQueries({ queryKey: ["stores-admin"] });
    },
  });

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<{ orders: Order[] }>("/api/orders"),
  });
  const { data: productsData } = useQuery({
    queryKey: ["vendor-products"],
    queryFn: () => api<{ items: Product[] }>("/api/products?mine=1"),
  });
  const { data: payoutsData } = useQuery({
    queryKey: ["payouts"],
    queryFn: () => api<{ payouts: Payout[] }>("/api/payouts"),
  });

  const stats = useMemo(() => {
    const orders = ordersData?.orders ?? [];
    const active = orders.filter((o) => o.status !== "CANCELLED");
    const revenue = active.reduce((s, o) => s + o.items.reduce((x, i) => x + i.vendorEarnings, 0), 0);
    const gross = active.reduce((s, o) => s + o.items.reduce((x, i) => x + i.lineTotal, 0), 0);
    const openCount = orders.filter((o) => ["PAID", "PROCESSING"].includes(o.status)).length;
    return { revenue, gross, openCount, orderCount: active.length };
  }, [ordersData]);

  if (!user?.store) return null;
  const store = user.store;

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description,
      price: (p.priceCents / 100).toFixed(2),
      compareAt: p.compareAtPriceCents ? (p.compareAtPriceCents / 100).toFixed(2) : "",
      imageUrl: p.imageUrl,
      category: p.category,
      tags: p.tags,
      stock: String(p.stock),
      featured: p.featured,
    });
    setDialogOpen(true);
  };

  const saveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        name: form.name,
        description: form.description,
        priceCents: Math.round(parseFloat(form.price) * 100),
        ...(form.compareAt ? { compareAtPriceCents: Math.round(parseFloat(form.compareAt) * 100) } : {}),
        imageUrl: form.imageUrl || "/products/hero-marketplace.jpg",
        category: form.category,
        tags: form.tags,
        stock: parseInt(form.stock, 10) || 0,
        featured: form.featured,
      };
      if (editing) {
        await api(`/api/products/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.success("Product updated");
      } else {
        await api("/api/products", { method: "POST", body: JSON.stringify(body) });
        toast.success("Product created", { description: store.status === "ACTIVE" ? "Live in the catalog." : "Visible once your store is approved." });
      }
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["vendor-products"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (p: Product) => {
    try {
      await api(`/api/products/${p.id}`, { method: "DELETE" });
      toast.success(`Deleted ${p.name}`);
      queryClient.invalidateQueries({ queryKey: ["vendor-products"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Delete failed.");
    }
  };

  const advance = async (o: Order, to: OrderStatus) => {
    try {
      await api(`/api/orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: to }) });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(`${o.orderNumber} → ${to}`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Update failed.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Store header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-2xl" aria-hidden>{store.logoEmoji ?? "🏬"}</span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{store.name}</h1>
            <p className="text-sm text-muted-foreground">Vendor workspace · commission {(store.commissionRate * 100).toFixed(0)}%</p>
          </div>
        </div>
        <Badge variant={store.status === "ACTIVE" ? "default" : store.status === "PENDING" ? "outline" : "destructive"} className="px-3 py-1 text-xs">
          {store.status === "ACTIVE" ? "Store live" : store.status === "PENDING" ? "Awaiting admin approval" : "Suspended"}
        </Badge>
      </div>

      {store.status !== "ACTIVE" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {store.status === "PENDING"
            ? "Your store is pending approval. You can manage inventory now — products appear in the public catalog once an admin approves the store."
            : "Your store is suspended. Products are hidden from the catalog. Contact the platform admin."}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: DollarSign, label: "Net earnings", value: money(stats.revenue), hint: `gross ${money(stats.gross)}` },
          { icon: TrendingUp, label: "Orders", value: String(stats.orderCount), hint: `${stats.openCount} open` },
          { icon: Package, label: "Products", value: String(productsData?.items.length ?? 0), hint: "SKUs listed" },
          { icon: ShoppingCart, label: "Avg order", value: stats.orderCount ? money(Math.round(stats.gross / stats.orderCount)) : "—", hint: "your items only" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">{s.label}</span>
              <s.icon className="size-4 text-primary" aria-hidden />
            </div>
            <p className="mt-1.5 text-xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
        <Tabs defaultValue="orders" className="space-y-4">
          <TabsList>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="payouts">Payouts</TabsTrigger>
          </TabsList>

          {/* Orders tab */}
          <TabsContent value="orders" className="space-y-3">
            {ordersLoading ? (
              <Skeleton className="h-48 rounded-xl" />
            ) : (ordersData?.orders ?? []).length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
                No orders yet — they will appear here the moment a customer checks out.
              </div>
            ) : (
              (ordersData?.orders ?? []).map((o) => {
                const next = NEXT_ACTION[o.status];
                const mine = o.items;
                return (
                  <div key={o.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-sm font-semibold">{o.orderNumber}</p>
                        <p className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString()} · {o.customerName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={statusVariant[o.status] ?? "outline"}>{o.status}</Badge>
                        {next && (
                          <Button size="sm" onClick={() => advance(o, next.to)}>{next.label}</Button>
                        )}
                      </div>
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {mine.map((it) => (
                        <li key={it.id} className="flex items-center gap-2.5 text-sm">
                          <div className="relative size-9 shrink-0 overflow-hidden rounded border bg-muted">
                            <Image src={it.imageUrl} alt={it.productName} fill sizes="36px" className="object-cover" />
                          </div>
                          <span className="min-w-0 flex-1 truncate">{it.productName} ×{it.quantity}</span>
                          <span className="text-xs text-muted-foreground">you earn {money(it.vendorEarnings)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 border-t pt-3">
                      <OrderTimeline order={o} />
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>

          {/* Products tab */}
          <TabsContent value="products" className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{productsData?.items.length ?? 0} products</p>
              <Button size="sm" className="gap-1.5" onClick={openCreate}>
                <Plus className="size-4" aria-hidden /> New product
              </Button>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <div className="custom-scroll max-h-[28rem] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Product</th>
                      <th className="px-3 py-2.5 font-medium">Price</th>
                      <th className="px-3 py-2.5 font-medium">Stock</th>
                      <th className="px-3 py-2.5 font-medium">Featured</th>
                      <th className="px-3 py-2.5" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(productsData?.items ?? []).map((p) => (
                      <tr key={p.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="relative size-9 shrink-0 overflow-hidden rounded border bg-muted">
                              <Image src={p.imageUrl} alt="" fill sizes="36px" className="object-cover" />
                            </div>
                            <span className="max-w-40 truncate font-medium sm:max-w-none">{p.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">{money(p.priceCents)}</td>
                        <td className="px-3 py-2.5">
                          <span className={p.stock === 0 ? "font-semibold text-destructive" : p.stock < 10 ? "font-semibold text-amber-600" : ""}>{p.stock}</span>
                        </td>
                        <td className="px-3 py-2.5">{p.featured ? <Badge variant="secondary">Featured</Badge> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
                              <Pencil className="size-3.5" aria-hidden />
                            </Button>
                            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => deleteProduct(p)} aria-label={`Delete ${p.name}`}>
                              <Trash2 className="size-3.5" aria-hidden />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* Payouts tab */}
          <TabsContent value="payouts" className="space-y-3">
            {(payoutsData?.payouts ?? []).length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
                No payouts yet. Vendor earnings appear here after each paid order.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Order</th>
                      <th className="px-3 py-2.5 font-medium">You earn</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Transfer</th>
                      <th className="px-3 py-2.5 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(payoutsData?.payouts ?? []).map((py) => (
                      <tr key={py.id}>
                        <td className="px-4 py-2.5 font-mono text-xs">{py.order?.orderNumber ?? "—"}</td>
                        <td className="px-3 py-2.5 font-semibold">{money(py.amount)}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant={py.status === "AVAILABLE" || py.status === "PAID" ? "default" : py.status === "REVERSED" ? "destructive" : "outline"}>
                            {py.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{py.transferId ?? "—"}</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{new Date(py.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Realtime feed */}
        <aside className="space-y-3 rounded-xl border p-4" aria-label="Realtime activity">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Radio className="size-4 text-primary" aria-hidden /> Live activity
            </h2>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {status === "connected" ? <Wifi className="size-3.5 text-primary" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
              {status}
            </span>
          </div>
          {feed.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              New orders and status changes appear here instantly via WebSocket.
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

      {/* Product dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="custom-scroll max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit product" : "New product"}</DialogTitle>
            <DialogDescription>Prices in USD. Inventory changes apply immediately.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveProduct} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-desc">Description</Label>
              <Input id="p-desc" required maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="p-price">Price ($)</Label>
                <Input id="p-price" required type="number" min="0.5" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-compare">Compare at ($, optional)</Label>
                <Input id="p-compare" type="number" min="0.5" step="0.01" value={form.compareAt} onChange={(e) => setForm({ ...form, compareAt: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="p-stock">Stock</Label>
                <Input id="p-stock" required type="number" min="0" step="1" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-tags">Search tags</Label>
              <Input id="p-tags" maxLength={200} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="comma,separated,keywords — used by search and the AI assistant" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-image">Image URL</Label>
              <Input id="p-image" required maxLength={500} value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="/products/my-item.jpg or https://…" />
              {form.imageUrl && (
                <div className="relative size-20 overflow-hidden rounded-lg border bg-muted">
                  <Image src={form.imageUrl} alt="Preview" fill sizes="80px" className="object-cover" unoptimized={form.imageUrl.startsWith("http")} />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="p-featured">Featured</Label>
                <p className="text-xs text-muted-foreground">Featured items rank first in the catalog</p>
              </div>
              <Switch id="p-featured" checked={form.featured} onCheckedChange={(v) => setForm({ ...form, featured: v })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create product"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
