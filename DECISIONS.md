# Meridian Market — Architecture Decision Record

Twelve decisions that shaped this codebase, written interview-grade: for each, the context that forced a choice, the decision, the trade-offs accepted, and why the obvious alternative lost. Status: all accepted and implemented; revisit triggers noted where they exist.

---

## 1. Next.js App Router API routes over a separate Express service

**Context.** The platform exposes one application entry (the Next.js app on :3000). The marketplace needs ~25 REST endpoints plus SSR-capable rendering, and the team is small.

**Decision.** Implement the entire HTTP API as App Router route handlers under `src/app/api/`, composed through a single `withApi` middleware (`src/lib/api.ts`) that owns the pipeline: rate limit → same-origin/CSRF → session → RBAC → handler → typed error envelope.

**Trade-offs.** Route handlers couple API and UI deployment cadence; there is no independent API scaling; long-lived workloads (websockets) cannot live inside the Next.js process — which is exactly why the realtime service exists as a separate process (decision 5).

**Why not the alternative.** A separate Express/Fastify service means a second process to host (the sandbox exposes one web port), a CORS layer (same-origin becomes cross-origin), duplicated session/config plumbing, and a proxy just to reunite the two on one origin. Next.js route handlers give the same middleware composition pattern (one function wrapping every handler) with zero extra infrastructure. The `withApi` wrapper keeps pipeline logic in one auditable file, so we get Express-style cross-cutting concerns without Express.

## 2. SQLite via Prisma in sandbox, Postgres in production; constrained strings + a Zod type layer

**Context.** The sandbox has no Postgres daemon but the production schema must be Postgres-ready. Prisma does not support enums on SQLite.

**Decision.** `datasource` is `sqlite` with `DATABASE_URL` pointing at `db/custom.db`; roles, order/store/payout statuses and categories are stored as constrained `String` columns. The literal unions live in `src/lib/constants.ts` (`ROLES`, `ORDER_STATUSES`, …) and are enforced at every boundary by Zod schemas in `src/lib/validation.ts`, so the database string is never trusted raw. Switching to Postgres is a `provider` flip plus converting the unions to native `enum` blocks — no application code changes.

**Trade-offs.** The DB itself will accept an invalid status string (defense lives in the app layer, not the engine); SQLite's single-writer lock caps concurrent writes.

**Why not the alternative.** (a) Native Prisma enums everywhere would have forced Postgres in the sandbox — impossible here. (b) Free-form strings with no type layer would push validation drift into runtime bugs; the constants + Zod layer keeps a single source of truth that the compiler checks, and hot-path foreign keys are indexed so the Postgres port performs from day one.

## 3. Custom opaque session table + scrypt instead of NextAuth/JWT

**Context.** Auth needs three roles, vendor-store linkage, "sign out everywhere", and a guest-identity primitive for carts — nothing exotic. `next-auth` is in the dependency tree of the scaffold.

**Decision.** Hand-rolled sessions: scrypt password hashing (16-byte salt, 64-byte derived key, `timingSafeEqual`), 32-byte random opaque tokens persisted in a `Session` row, delivered as an httpOnly `SameSite=Lax` cookie with a 7-day TTL (`SESSION_TTL_DAYS = 7`). `getSessionUser()` joins session → user → store and opportunistically deletes expired rows.

**Trade-offs.** Every authenticated request costs one indexed DB lookup (no stateless verification); we own the auth code (revoke, expiry, hashing parameters) with no upstream security patch pipeline.

**Why not the alternative.** NextAuth/Auth.js buys OAuth provider breadth this project doesn't need, adds an adapter layer over the exact tables we already model, and its Credentials+JWT mode introduces stateless tokens we'd have to work around for server-side revocation. Raw JWTs alone make "sign out everywhere" impossible without a denylist — at which point you have built the session table anyway, minus the revocation. Mitigating the ownership cost: the module's API surface is deliberately Auth.js-shaped (`auth()`-style `getSessionUser`, `requireRole`-style `withApi` roles), so migrating to NextAuth later is a drop-in change at call sites.

## 4. Simulated Stripe Connect mirroring the exact PI/transfer/webhook-signature contract, instead of a mocking library

**Context.** The sandbox has no Stripe keys, but the split-payment logic (10% commission, per-store transfers, webhook-driven settlement) is the heart of the product and must be demonstrably correct.

**Decision.** `src/lib/payments.ts` implements the production contract natively: `pi_`/`tr_`/`evt_` prefixed identifiers, PaymentIntent `requires_capture → succeeded` lifecycle, per-line `computeSplits` with one transfer per store, and webhook signing exactly like Stripe: `stripe-signature: t=<ts>,v1=<HMAC-SHA256>` over `<ts>.<payload>`, verified timing-safely with a 5-minute replay window. Checkout even delivers the signed webhook **to this app's own `/api/webhooks/stripe` endpoint** over HTTP, proving the loop end to end.

**Trade-offs.** Simulator code exists that must eventually be deleted; no real 3DS/card error surfaces are exercised.

**Why not the alternative.** A mocking library (e.g. `stripe-mock` or Jest-level stubs) verifies the *client library's* contract, not *ours*: it can't exercise our raw-body signature check, our replay window, our idempotent settlement, or the self-delivery loop. Because the simulation reproduces the wire format rather than replacing it, swapping to the real SDK is confined to three function bodies (`createPaymentIntent`, `captureWithSplits`, delete the self-delivery block) while `verifyWebhookSignature` and the webhook route stay byte-for-byte identical — see the checklist in README.

## 5. socket.io mini-service with HMAC room tickets; control-plane split between :3003 and :3004

**Context.** Vendors and admins need sub-second order notifications. The platform gateway forwards one port to Next.js; engine.io must own path `/` on the public port (the gateway's `XTransformPort` contract routes browsers to :3003 that way). Next.js (serverless-style) cannot host long-lived socket connections.

**Decision.** A standalone Bun service (`mini-services/realtime`) runs socket.io on :3003 with `path: "/"`. Room membership is never client-declared: browsers fetch `GET /api/realtime/ticket`, which mints a 60-second HMAC-SHA256 ticket (`{sub, role, storeId, exp}`, signed with `AUTH_SECRET`); the service verifies it and joins the socket only to `user:<id>` (+ `store:<id>` for vendors, + `admin` for admins). Server-to-server broadcasts arrive on a separate control-plane HTTP server on :3004 (`POST /emit`, guarded by `x-realtime-secret`, bound to `127.0.0.1`, 1 MB body guard); the Next.js side (`src/lib/realtime.ts`) is fire-and-forget with a 2-second timeout and one retry.

**Trade-offs.** A second process to deploy and monitor; the ticket is bearer-for-60-seconds (acceptable because the only power it grants is *receiving* your own rooms' events); `emitRealtime` is at-most-twice delivery, not guaranteed — the UI re-fetches on `visibilitychange` as backstop.

**Why not the alternative.** Polling burns rate-limit budget (deliberately tight: 60/min on order lists) and adds latency that makes the "vendor live feed" demo underwhelming. Pusher/Ably add a vendor account and move room authorization into their dashboard, losing the in-repo, auditable ticket format. Hosting socket.io inside Next.js isn't possible with the platform's process model — and putting `/emit` on the same port would fight engine.io's ownership of `/`, hence the 3003/3004 split.

## 6. RAG-lite scored retrieval over embeddings at 12–200 SKU scale

**Context.** The AI assistant must answer product questions from the live catalog without inventing items. Catalog size is 12 SKUs seeded, expected low hundreds.

**Decision.** `src/lib/ai.ts` does deterministic retrieval: regex budget extraction ("under $150"), stop-word-filtered tokenization, weighted substring scoring (name ×5, tags ×3, category ×3, description ×1, + rating and featured boosts) over ACTIVE stores with stock, take 200, top 6 injected into a strict system prompt ("recommend ONLY from the catalog"). The LLM call goes through `z-ai-web-dev-sdk` with `thinking: disabled`; any LLM failure falls back to a deterministic recommender and flags `degraded: true`.

**Trade-offs.** Substring scoring misses paraphrase ("cozy" won't match "blanket" unless tagged); retrieval quality depends on seed tagging discipline.

**Why not the alternative.** Embeddings + a vector store mean an embedding pipeline on every product write, a similarity index to host, and dimension drift to manage — for a catalog that fits in one `take: 200` scan with headroom to spare. The scoring function is ~30 debuggable lines, zero extra infra, and its recall is directly improved by better tags (which vendors already manage). The documented upgrade path: when catalog > ~1k SKUs or paraphrase recall becomes a measured problem, add a `description` embedding column and pgvector cosine top-k, keeping the same prompt contract — retrieval stays a pure function returning `RetrievedProduct[]`.

## 7. Integer cents everywhere with a single rounding point

**Context.** Money flows through carts, per-line commission splits (10% default), order totals, payouts and admin GMV reports. Floating-point drift is unacceptable in any of them.

**Decision.** Every monetary value is an integer number of cents from Zod input (`priceCents`) to Prisma storage. Exactly one place rounds: `computeLineSplit` computes `commission = Math.round(lineTotal * rate)` and `vendorEarnings = lineTotal - commission`. The invariant `commission + vendorEarnings === lineTotal` holds on every line, so order-level sums never reconcile off by a cent. Client-facing formatting happens only at the presentation edge via `formatCents` (`Intl.NumberFormat`).

**Trade-offs.** Every API consumer deals in cents (documented in field names); rounding favors the platform on half-cent lines (round-half-up).

**Why not the alternative.** Float dollars with end-of-pipeline rounding produces the classic 0.1+0.2 artifacts and, worse, makes the commission invariant unauditable. Decimal libraries (decimal.js) or Postgres `NUMERIC(10,2)` move the problem but still require a defined rounding mode at the split; centralizing it in one 8-line function is cheaper to audit than a dependency, and the DB-agnostic integer representation survives the Postgres port unchanged.

## 8. In-memory TTL cache and rate limiter behind narrow interfaces as Redis swap points

**Context.** Product listing and admin stats queries benefit from short TTL caching; every route needs rate limiting. The sandbox runs a single node with no Redis.

**Decision.** `src/lib/cache.ts` (~40 lines: `cacheGet/cacheSet/cacheInvalidatePrefix/cached`) and `src/lib/rate-limit.ts` (windowed counters keyed `ip:path:method` with `sweepRateLimiter()` cleanup) both run in process memory and are only ever accessed through their exported function signatures. Product lists cache 10s, admin stats 5s; mutations invalidate the `products:` prefix.

**Trade-offs.** Per-instance state: with N app instances each has its own counters and cache (limits effectively multiply, invalidation doesn't propagate); a restart forgets everything.

**Why not the alternative.** Actual Redis in the sandbox adds a daemon and a failure mode for a demo that runs one process. Making the interfaces narrow *now* is the whole point: swapping to Redis is re-implementing `cacheGet/cacheSet` as `GET/SETEX` and `rateLimit` as `INCR`+`EXPIRE` with the same signatures — no call site changes. Deferring both the dependency and the design cost until the first multi-instance deployment (revisit trigger: horizontal scaling or Vercel multi-region).

## 9. Single-route SPA with hash-based client routing

**Context.** The deployment platform exposes exactly one application route (`/` on the Next.js port). A marketplace needs many logical views: catalog, product, cart, checkout, vendor dashboard, admin console, auth screens.

**Decision.** Ship one client-rendered route; all navigation is client-side state (hash fragments), with Zustand holding UI/session state and TanStack Query owning server state against the `/api/*` surface. Deep links work via the hash; no server round-trips between views.

**Trade-offs.** No per-URL SSR/SEO on inner pages (product pages aren't individually server-rendered at their own URLs); browser history semantics are hash-based; server components' streaming benefits are largely unused.

**Why not the alternative.** App Router nested routes (`/product/[slug]`, `/vendor/orders`) are the idiomatic choice but require the platform to expose those paths — it exposes one. Query-param emulation of routing hits the same wall with uglier URLs and history spam. Accepting the constraint concentrates server effort where it matters here (the API), and a future move to real routes is mechanical: the views already communicate only through the API and stores, so mapping each view to a route segment requires no data-layer rewrite.

## 10. Order state machine with transition authorship; PAID settable only by the webhook

**Context.** Orders move PENDING → PAID → PROCESSING → SHIPPED → DELIVERED, with cancellations from three states. Vendors, admins and customers all have write access to *some* transitions — and "paid" is a financial fact, not an opinion.

**Decision.** `src/lib/constants.ts` declares two tables: `ORDER_TRANSITIONS` (legal edges; terminal states have empty arrays) and `TRANSITION_AUTHORS` (which roles may author each target status — `PAID: []` meaning the payment system/webhook path exclusively; no human role may set PAID). `PATCH /api/orders/:id` enforces both plus object-level rules (vendor must be a participant; customer may cancel only PENDING/PAID orders of their own). Every transition appends an `OrderEvent` row; cancellation restocks inventory and reverses `PENDING`/`AVAILABLE` payouts to `REVERSED`, all in one transaction, followed by a realtime `order:status` broadcast.

**Trade-offs.** The authorship table is convention (a determined admin could call the internal settle path) rather than cryptographic enforcement; adding a status means touching two tables plus the UI.

**Why not the alternative.** Scattered `if (status === …)` checks in handlers drift and miss edges; a full workflow engine is overkill for six states. Encoding the machine as *data* makes it unit-testable in one table-driven test, renders directly as the Mermaid state diagram in the README, and gives the webhook an unambiguous monopoly on money-state transitions — a customer or vendor can never mark anything paid, even with a valid session.

## 11. Order item snapshotting for historical reporting

**Context.** Products get renamed and repriced, stores get renamed, products get deleted — but vendor earnings reports, payout ledgers and admin GMV must reflect what was actually sold, at the price actually charged, under the commission actually agreed.

**Decision.** `OrderItem` copies at purchase time: `productName`, `storeName`, `imageUrl`, `unitPrice`, `quantity`, `lineTotal`, `commissionRate`, `commission`, `vendorEarnings`. The FK to `Product` is nullable; product deletion (which must keep order history intact) removes the row from carts but leaves order items with their snapshots.

**Trade-offs.** Wider rows and denormalization (names repeated per line); refunds must be computed from the snapshot, not the live catalog.

**Why not the alternative.** Joining live `Product`/`Store` rows at report time silently rewrites history: a vendor rename would retroactively change last quarter's payout ledger, and deleted products would null out line items. An event-sourced ledger would preserve history too, but at the cost of a projection layer for every read — snapshots give 95% of the guarantee (the admin stats endpoint sums them directly) at 5% of the complexity.

## 12. Cart merge-on-login with a guest-token cookie

**Context.** Conversion best practice: let guests build a cart with zero friction, then keep it when they sign in — and let signed-out users retain carts across visits.

**Decision.** `Cart` is keyed by either `userId` (unique) or `guestToken` (unique, a 30-day httpOnly cookie minted on first cart write). On login, `mergeGuestCartIntoUser` runs a transaction: for each guest item, quantities sum into the user cart capped to `min(stock, 20)`, unit price refreshes from the server-side product row, the guest cart row is deleted and the guest cookie cleared. Cart APIs resolve the cart via `resolveCart(user)` so one code path serves both states.

**Trade-offs.** One more cookie on anonymous traffic; merges cap at stock, so a guest adding 10 of a 5-stock item silently becomes 5 (surfaced by the cart UI).

**Why not the alternative.** Guest carts keyed by a signed-out user row would require account creation pre-checkout (friction) and pollute the user table; localStorage carts die across devices and can't be validated server-side against stock; abandoning the guest cart on login (the "easy" option) is the exact conversion loss the feature exists to prevent. The cookie is httpOnly (not readable by XSS payload scripts) and the merge runs server-side where stock truth lives.
