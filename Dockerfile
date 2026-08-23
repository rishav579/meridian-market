# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Meridian Market — Next.js app (standalone output, Bun runtime)
# Build:  docker build -t meridian-app .
# Run:    docker run -p 3000:3000 --env-file .env meridian-app
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependencies ────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time placeholders only — nothing secret is embedded in build output.
ARG DATABASE_URL="file:/tmp/build.db"
ARG AUTH_SECRET="build_placeholder"
ARG REALTIME_SECRET="build_placeholder"
ARG STRIPE_WEBHOOK_SECRET="whsec_build_placeholder"
ARG NEXT_PUBLIC_APP_NAME="Meridian Market"
# Generate the Prisma client, then produce the standalone Next.js bundle.
# `bun run build` = next build + copy .next/static and public/ into .next/standalone.
RUN bunx prisma generate && bun run build

# ── Stage 3: slim runner ─────────────────────────────────────────────────────
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# Non-root runtime user (bundled with the base image) + writable SQLite dir.
RUN mkdir -p /app/db && chown -R bun:bun /app
USER bun

# Standalone bundle: server.js + traced node_modules + static assets + public/
COPY --from=builder --chown=bun:bun /app/.next/standalone ./

EXPOSE 3000

# Liveness: same endpoint docker-compose and uptime probes use.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "server.js"]
