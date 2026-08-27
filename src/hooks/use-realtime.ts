"use client";

/**
 * useRealtime — socket.io connection with HMAC ticket room authorization.
 * Connects via the platform gateway (path "/", XTransformPort=3003), then
 * authenticates with a 60s ticket from /api/realtime/ticket. Rooms are assigned
 * server-side; the client can never join arbitrary rooms.
 */

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { RealtimeFeedItem } from "@/lib/client/types";

export type RealtimeStatus = "off" | "connecting" | "connected";

interface RealtimeEventPayload {
  orderId?: string;
  orderNumber?: string;
  status?: string;
  to?: string;
  from?: string;
  message?: string;
  total?: number;
  customerName?: string;
  itemCount?: number;
  storeName?: string;
  at?: string;
}

export function useRealtime(params: {
  enabled: boolean;
  onEvent: (item: RealtimeFeedItem) => void;
}): RealtimeStatus {
  const { enabled, onEvent } = params;
  const [status, setStatus] = useState<RealtimeStatus>("off");
  const handlerRef = useRef(onEvent);

  // Keep the latest handler without touching refs during render.
  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) {
      const off = setTimeout(() => setStatus("off"), 0);
      return () => clearTimeout(off);
    }

    let disposed = false;
    let socket: Socket | null = null;

    const run = async () => {
      const { io } = await import("socket.io-client");
      if (disposed) return;
      setStatus("connecting");

      socket = io("/?XTransformPort=3003", {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 12,
        reconnectionDelay: 1500,
        timeout: 10_000,
      });

      const authenticate = async () => {
        try {
          const res = await fetch("/api/realtime/ticket", { credentials: "same-origin" });
          if (!res.ok) return;
          const { ticket } = (await res.json()) as { ticket: string };
          socket?.emit("authenticate", { ticket });
        } catch {
          /* offline — socket.io will reconnect and retry */
        }
      };

      socket.on("connect", () => {
        setStatus("connected");
        void authenticate();
      });

      socket.on("disconnect", () => setStatus("connecting"));

      const feed = (event: RealtimeFeedItem["event"], p: RealtimeEventPayload) => {
        const at = p.at ?? new Date().toISOString();
        if (event === "order:new") {
          handlerRef.current({
            id: `${p.orderId}-${at}`,
            event,
            label: `New order ${p.orderNumber ?? ""}`,
            detail: `${p.customerName ?? "Guest"} · ${(p.total ?? 0) / 100 >= 0 ? `$${(((p.total ?? 0) / 100) as number).toFixed(2)}` : ""} · ${p.itemCount ?? 0} item(s)`,
            at,
          });
        } else if (event === "order:status") {
          handlerRef.current({
            id: `${p.orderId}-${at}`,
            event,
            label: `${p.orderNumber ?? "Order"} → ${p.to ?? ""}`,
            detail: p.message ?? "",
            at,
          });
        } else if (event === "payout:update") {
          handlerRef.current({
            id: `payout-${at}`,
            event,
            label: `Store ${p.storeName ?? ""} ${p.status ?? ""}`.trim(),
            detail: "Store status updated by platform",
            at,
          });
        }
      };

      socket.on("order:new", (p: RealtimeEventPayload) => feed("order:new", p));
      socket.on("order:status", (p: RealtimeEventPayload) => feed("order:status", p));
      socket.on("payout:update", (p: RealtimeEventPayload) => feed("payout:update", p));
    };

    void run();

    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [enabled]);

  return status;
}
