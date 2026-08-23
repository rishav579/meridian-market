"use client";

import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, money, ApiClientError } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { useRealtime } from "@/hooks/use-realtime";
import type { Order, OrderStatus } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Package, ChevronDown, XCircle, Wifi, WifiOff } from "lucide-react";

const STATUS_STEPS: OrderStatus[] = ["PENDING", "PAID", "PROCESSING", "SHIPPED", "DELIVERED"];

const statusVariant: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  PENDING: "outline",
  PAID: "secondary",
  PROCESSING: "secondary",
  SHIPPED: "default",
  DELIVERED: "default",
  CANCELLED: "destructive",
};

export function OrderTimeline({ order }: { order: Order }) {
  const activeIdx = order.status === "CANCELLED" ? -1 : STATUS_STEPS.indexOf(order.status);
  return (
    <div>
      {order.status === "CANCELLED" ? (
        <p className="flex items-center gap-2 text-sm font-medium text-destructive">
          <XCircle className="size-4" aria-hidden /> Order cancelled
        </p>
      ) : (
        <ol className="flex flex-wrap items-center gap-1.5" aria-label="Order progress">
          {STATUS_STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              <span
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  i <= activeIdx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
                aria-current={i === activeIdx ? "step" : undefined}
              >
                {i <= activeIdx ? "✓" : i + 1} {s[0] + s.slice(1).toLowerCase()}
              </span>
              {i < STATUS_STEPS.length - 1 && <span className="hidden text-muted-foreground sm:inline" aria-hidden>→</span>}
            </li>
          ))}
        </ol>
      )}
      {order.events.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {order.events.slice(-3).map((ev) => (
            <li key={ev.id}>{new Date(ev.createdAt).toLocaleString()} — {ev.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OrdersView() {
  const user = useApp((s) => s.user);
  const openAuth = useApp((s) => s.openAuth);
  const navigate = useApp((s) => s.navigate);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<{ orders: Order[] }>("/api/orders"),
    enabled: Boolean(user),
  });

  const status = useRealtime({
    enabled: Boolean(user),
    onEvent: (item) => {
      if (item.event === "order:status" || item.event === "order:new") {
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        toast.info(item.label, { description: item.detail });
      }
    },
  });

  const cancel = async (id: string) => {
    try {
      await api(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status: "CANCELLED" }) });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order cancelled", { description: "Inventory restocked; payment reversed." });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Cancel failed.");
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-20 text-center">
        <Package className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">Track your orders</h1>
        <p className="max-w-sm text-sm text-muted-foreground">Sign in to see live status updates for your purchases.</p>
        <Button onClick={() => openAuth("login")}>Sign in</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">My orders</h1>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          {status === "connected" ? <Wifi className="size-3.5 text-primary" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
          {status === "connected" ? "Live updates on" : status === "connecting" ? "Connecting…" : "Realtime off"}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}</div>
      ) : !data || data.orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-16 text-center">
          <p className="font-medium">No orders yet</p>
          <Button variant="outline" onClick={() => navigate({ name: "home" })}>Start shopping</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {data.orders.map((o) => (
            <Collapsible key={o.id} className="rounded-xl border">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold">{o.orderNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(o.createdAt).toLocaleDateString()} · {o.items.length} item{o.items.length === 1 ? "" : "s"} · {money(o.total)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant[o.status] ?? "outline"}>{o.status}</Badge>
                  {(o.status === "PENDING" || o.status === "PAID") && (
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => cancel(o.id)}>
                      Cancel
                    </Button>
                  )}
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1">
                      Details <ChevronDown className="size-3.5" aria-hidden />
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </div>
              <CollapsibleContent>
                <div className="space-y-4 border-t p-4">
                  <OrderTimeline order={o} />
                  <ul className="space-y-2">
                    {o.items.map((it) => (
                      <li key={it.id} className="flex items-center gap-3">
                        <div className="relative size-11 shrink-0 overflow-hidden rounded-md border bg-muted">
                          <Image src={it.imageUrl} alt={it.productName} fill sizes="44px" className="object-cover" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{it.productName}</p>
                          <p className="text-xs text-muted-foreground">{it.storeName} · qty {it.quantity}</p>
                        </div>
                        <p className="text-sm font-semibold">{money(it.lineTotal)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      )}
    </div>
  );
}
