# ─────────────────────────────────────────────────────────────────────────────
# Meridian Market — realtime mini-service (socket.io :3003 + control :3004)
# Bun runs TypeScript natively; no build step required.
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1-slim
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY index.ts ./

# Non-root runtime user bundled with the base image.
USER bun

# 3003 = socket.io (engine.io owns "/"); 3004 = internal emit control plane.
EXPOSE 3003 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3003/?EIO=4&transport=polling').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "index.ts"]
