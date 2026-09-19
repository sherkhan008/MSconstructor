# Supplier price import

How an approved supplier price list becomes the live catalog price, without a
single real purchase price entering this (public) repository.

* Importer: [`scripts/import-supplier-prices.ts`](../scripts/import-supplier-prices.ts)
* npm script: `npm run db:import-supplier-prices`
* Input file (PRIVATE, never committed): `private-data/pricing/<model>.csv`

`private-data/` is listed in both `.gitignore` and `.dockerignore`, so the file
is never tracked by git and never copied into a Docker image. It is supplied
out-of-band (secure transfer / password manager / the finance share) on the
machine that runs the import.

## File format

Plain comma-separated text, one model per file. Blank lines and `#` comments are
ignored; the header row must match exactly:

```
model,kind,height,width,depth,purchasePrice,sellingPrice
```

| column          | meaning                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `model`         | product model slug, e.g. `ms-standard`                                      |
| `kind`          | `UPRIGHT` or `SHELF_STANDARD`                                               |
| `height`        | upright height in mm (`UPRIGHT` only)                                       |
| `width`,`depth` | shelf size in mm (`SHELF_STANDARD` only)                                    |
| `purchasePrice` | supplier price as quoted, VAT-inclusive, decimal string                     |
| `sellingPrice`  | approved customer price (supplier price + agreed uplift), whole tenge       |

A runnable example with **invented** figures lives at
[`docs/examples/supplier-prices.example.csv`](examples/supplier-prices.example.csv).

## What the importer guarantees

* **Dry run by default** — `--apply` is the only thing that writes.
* **Structural matching, never names.** An `UPRIGHT` row matches the component
  with `type=UPRIGHT`, that `height`, no `loadCapacity` (i.e. the standard,
  non-heavy variant), no other discriminator, and compatible with the model. A
  `SHELF_STANDARD` row matches `type=SHELF`, `shelfType=STANDARD`, that
  `width`×`depth`, compatible with the model. Zero matches or more than one
  match fails the whole import.
* **Coverage check** against the authoritative matrix in
  `src/lib/pricing/ms-standard-compatibility.ts`: every model height and every
  valid width×depth pair must appear exactly once. A missing row, a duplicate
  row, or a row the model cannot even configure is rejected — so for MS Standard
  the file must contain exactly 7 uprights + 19 shelves = 26 rows.
* **Uplift check**: `sellingPrice` must equal `purchasePrice + uplift%` rounded
  half-up to whole tenge (`--uplift-percent`, default 15; `--no-uplift-check`
  to skip).
* **VAT check**: the import refuses to run unless `PricingSettings.vatPercent`
  equals the rate the list is quoted at (16%). It sets `pricesIncludeVat = true`
  only if it is not already true — the supplier's figures are VAT-inclusive, and
  storing them while the engine believes prices are net would charge VAT twice.
* **Transactional apply**: the complete approved set is written or nothing is.
* **Audit trail**: one `PriceHistory` row per changed field (old value, new
  value, source description) plus one `AuditLog` row for the import. The actor
  is a system import — `adminId` is `NULL`, `adminName` carries the import label.
  No fake human admin account is created.
* It writes only `Component.sellingPrice` / `Component.purchasePrice`, the
  imported model's markup, and the VAT-inclusive flag. Orders, order items,
  document snapshots, payments and customers are never touched, so historical
  orders keep the prices they were placed at.

## Model markup

For a list whose `sellingPrice` column already contains the agreed uplift, the
importer sets that model's `markupPercent` and `markupFixed` to `0`, so the
pricing engine never applies a second markup on top of the supplier's. Other
models' markups are untouched.

## Running it

```bash
# 1. put the private file in place (never committed)
#    private-data/pricing/ms-standard.csv

# 2. review — zero database writes
npm run db:import-supplier-prices

# 3. apply, in one transaction
npm run db:import-supplier-prices -- --apply
```

## Production

The importer runs from the **`migrate`** service, not from `app`: that image
(Dockerfile target `migrator`) is the one that carries `src/`, `scripts/`, the
dev toolchain (`tsx`) and a direct database connection. The `app` image is a
Next.js standalone bundle and cannot run this script.

```bash
# 0. deploy as usual — the migrate service applies committed migrations
docker compose up -d --build

# 1. copy the private list to the host, out-of-band, readable only by you
#    (scp / password manager / secure share), e.g.
#    /srv/msconstructor/private-data/pricing/ms-standard.csv   (chmod 600)

# 2. REVIEW — zero database writes; read the 26-row table before going further
docker compose run --rm --no-deps \
  -v /srv/msconstructor/private-data:/app/private-data:ro \
  migrate npm run db:import-supplier-prices

# 3. APPLY — one transaction, all 26 rows or none
docker compose run --rm --no-deps \
  -v /srv/msconstructor/private-data:/app/private-data:ro \
  migrate npm run db:import-supplier-prices -- --apply
```

The mount is read-only and exists only for the duration of that one command.
The file is **never** baked into any image: `private-data` is in
`.dockerignore`, so `COPY . .` in the builder cannot pick it up. Remove the
host copy once the import is done if that machine should not retain it.

The running `app` containers pick the new prices up within
`CATALOG_CACHE_TTL_MS` (60s) — no restart or redeploy is needed.

Re-running `prisma db seed` afterwards is safe: every upsert in `prisma/seed.ts`
uses `update: {}`, so a re-seed never overwrites an imported price. Real supplier
prices are therefore never stored in `src/lib/data/seed-data.ts`.
