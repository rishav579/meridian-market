/**
 * Meridian Market — Realtime service (socket.io)
 *
 * Rooms: user:<userId> · store:<storeId> · admin
 *  • Browsers connect via the gateway: io("/?XTransformPort=3003")
 *  • Room joins are authorized by a short-lived HMAC ticket minted by
 *    GET /api/realtime/ticket (same AUTH_SECRET as the Next.js backend) —
 *    clients can never join rooms they don't own.
 *  • The Next.js backend broadcasts through POST /emit with a shared secret.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Server, type Socket } from "socket.io";

const PORT = 3003;
const AUTH_SECRET = process.env.AUTH_SECRET ?? "dev_auth_secret_change_me_in_production_9f3a2b";
const REALTIME_SECRET = process.env.REALTIME_SECRET ?? "dev_realtime_secret_change_me_7c1d";

interface TicketPayload {
  sub: string;
  role: "ADMIN" | "VENDOR" | "CUSTOMER";
  storeId: string | null;
  exp: number;
}

function verifyTicket(ticket: string): TicketPayload | null {
  const [body, sig] = ticket.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TicketPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

const httpServer = createServer();
const io = new Server(httpServer, {
  // Path must stay "/" — the gateway (Caddy) forwards on this contract.
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

/**
 * Control plane (internal-only, port 3004): separated from the socket.io port
 * because engine.io owns "/" on the public port per the gateway contract.
 * The Next.js backend POSTs signed broadcasts here.
 */
const controlServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "POST" && req.url === "/emit") {
    const secret = req.headers["x-realtime-secret"];
    if (!secret || secret !== REALTIME_SECRET) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 1_000_000) req.destroy(); // 1MB guard
    });
    req.on("end", () => {
      try {
        const { event, rooms, payload } = JSON.parse(body) as {
          event: string;
          rooms: string[];
          payload: Record<string, unknown>;
        };
        for (const room of rooms) io.to(room).emit(event, payload);
        console.log(`[emit] ${event} → ${rooms.join(", ")}`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad payload" }));
      }
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

io.on("connection", (socket: Socket) => {
  socket.on("authenticate", (data: { ticket?: string }, ack?: (result: { ok: boolean; rooms?: string[] }) => void) => {
    if (!data?.ticket) {
      ack?.({ ok: false });
      return;
    }
    const payload = verifyTicket(data.ticket);
    if (!payload) {
      ack?.({ ok: false });
      return;
    }

    const rooms: string[] = [`user:${payload.sub}`];
    if (payload.role === "ADMIN") rooms.push("admin");
    if (payload.role === "VENDOR" && payload.storeId) rooms.push(`store:${payload.storeId}`);

    for (const room of rooms) void socket.join(room);
    ack?.({ ok: true, rooms });
  });

  socket.on("disconnect", () => {
    /* rooms auto-released by socket.io */
  });
});

httpServer.listen(PORT, () => {
  console.log(`[realtime] socket.io listening on :${PORT}`);
});
controlServer.listen(3004, "127.0.0.1", () => {
  console.log(`[realtime] control plane listening on 127.0.0.1:3004`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
  controlServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
  controlServer.close(() => process.exit(0));
});
