/**
 * Realtime emitter — server-to-server bridge to the socket.io mini-service
 * (mini-services/realtime, port 3003). Authenticated by a shared secret so
 * only the Next.js backend can broadcast.
 */

export type RealtimeEvent = "order:new" | "order:status" | "payout:update";

export interface EmitPayload {
  event: RealtimeEvent;
  rooms: string[]; // e.g. ["store:ck123", "user:ck456", "admin"]
  payload: Record<string, unknown>;
}

const REALTIME_URL = process.env.REALTIME_INTERNAL_URL ?? "http://127.0.0.1:3004";

/** Fire-and-forget with one retry; realtime is an enhancement, never a dependency. */
export async function emitRealtime(body: EmitPayload): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${REALTIME_URL}/emit`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-realtime-secret": process.env.REALTIME_SECRET ?? "dev_realtime_secret_change_me_7c1d",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return;
    } catch {
      // retry once
    }
  }
  console.warn(`[realtime] emit failed: ${body.event} → ${body.rooms.join(", ")}`);
}

export function roomsForOrder(params: { userId: string | null; storeIds: string[] }): string[] {
  const rooms = new Set<string>(["admin"]);
  if (params.userId) rooms.add(`user:${params.userId}`);
  for (const id of params.storeIds) rooms.add(`store:${id}`);
  return [...rooms];
}
