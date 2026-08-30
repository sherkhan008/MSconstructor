# Production PostgreSQL deployment

Production always routes catalog, customers, orders, order items, and (once
used) payments through Prisma → PostgreSQL. There is no memory/mock fallback
at production runtime — see `src/lib/env.ts`'s `assertDatabaseConfigured`.

## 1. Create a PostgreSQL database

Any managed Postgres (Neon, Supabase, RDS, etc.) or self-hosted instance
works. `docker-compose.yml` in this repo also provisions a local Postgres
container if you want to rehearse the steps below before picking a host.

## 2. Set `DATABASE_URL`

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
```

This is the connection Prisma Client uses for every query at runtime. Point
it at a pooled connection (e.g. PgBouncer, or your provider's pooler) if one
is available.

## 3. Optionally set `DIRECT_URL`

```
DIRECT_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
```

Used only by `prisma migrate`/`prisma db pull`, which need an unpooled
connection to run schema commands. If your provider doesn't offer a separate
pooled endpoint, set `DIRECT_URL` to the same value as `DATABASE_URL`.

## 4. Install dependencies

```
npm ci
```

## 5. Generate the Prisma client

```
npx prisma generate
```

## 6. Apply migrations

```
npx prisma migrate deploy
```

Never use `prisma db push` or `prisma migrate dev` for a production
deployment — `migrate deploy` is the only command that applies the
committed, reviewable migration history in `prisma/migrations/` without
attempting to interactively resolve drift.

## 7. Load initial catalog data (once, intentionally)

```
npx prisma db seed
```

(equivalent to `npm run prisma:seed`). This is **not** wired into the deploy
pipeline and must never run automatically — see the warning below.

## 8. Start/deploy the application

Whatever your host's normal start command is (`npm run start`, a container
entrypoint, a serverless build). No special production-database flag is
needed beyond the environment variables above — `NODE_ENV=production` plus a
valid `DATABASE_URL` is what activates the PostgreSQL-backed repositories.

## 9. Check `/api/health`

```
curl https://your-domain/api/health
```

`200` with `"database": "postgres"` means the app is up and PostgreSQL is
reachable. A `503` means either `DATABASE_URL` isn't configured or the
database can't be reached right now — check application logs (the response
body never includes the connection string or the underlying driver error).

## 10. Create a test order

Complete a real checkout end to end, or `POST /api/orders` directly, then
confirm the returned `orderNumber` resolves at
`/order/success?number=<orderNumber>`.

## 11. Verify persistence across a restart/redeploy

Restart the application process (or redeploy), then look up the same order
number again — it must still be there. Production order data lives in
PostgreSQL, never in process memory, so this must survive any restart.

---

## Why an old order's total never changes

`Order.grandTotal`, `OrderItem.unitNetPrice`/`totalNetPrice`, and
`OrderItem.bomSnapshot` are written once, at order-creation time, from a
server-side `calculatePrice()` result — never recomputed from the current
catalog on a later read. Changing a `Component.sellingPrice` (or any other
current-price field) in PostgreSQL only affects *new* pricing calculations,
never orders already saved. See
`tests/integration/catalog-cache.test.ts` for the automated proof of this.

## How current prices become editable

`Component.sellingPrice`, `Accessory.unitPrice`, `ProductModel.markupPercent`
/`markupFixed`, and `PricingSettings` (VAT, default markup, discounts) are
all plain columns in PostgreSQL. Update them with SQL, Prisma Studio
(`npx prisma studio`), or a future admin UI (not built yet — see
`src/lib/payments/` and this repo's history for why that's a later phase) —
no code change or redeploy is required for a price to take effect. It takes
effect once the in-process catalog cache refreshes (see below), never
instantly across every server instance, but always within
`CATALOG_CACHE_TTL_MS` (currently 60s; see `src/lib/data/repository.ts`).

## Never run a destructive reset against a live production database

`npm run db:reset` (`prisma migrate reset --force`) drops and recreates the
schema. It is a development-only command. The seed script
(`prisma/seed.ts`) itself is safe to re-run against production (every write
is an `upsert`/`findFirst`-then-create with an empty `update: {}`, so it
never overwrites a price you've already changed in the database) — but
nothing in the deploy pipeline runs it automatically, and it should stay
that way. Loading initial catalog structure into a brand-new production
database is an intentional, one-time, manually-triggered step.

## What you still need to configure when you pick a PostgreSQL host

- The actual `DATABASE_URL`/`DIRECT_URL` values (never commit these).
- TLS/`sslmode` requirements your provider needs (see `.env.production.example`).
- Connection pool sizing appropriate for your host's concurrency model —
  this repo doesn't choose a provider or pooler, only supports the
  `DATABASE_URL`/`DIRECT_URL` split most providers expect.
- Automated backups/point-in-time recovery — not part of this application.
- Who is authorized to edit current catalog prices directly in the database
  until the admin price-editor UI (a later phase) exists.
