# Production deployment runbook

Single Linux host, Docker Compose, no orchestration platform. Files:
`docker-compose.yml`, `Dockerfile`, `deploy/nginx/`, `deploy/systemd/`,
`scripts/ops/`, `.env.production.example`.

Related: [backups and restore](production-backups.md) ·
[client IP and rate limiting](production-client-ip-and-rate-limiting.md) ·
[PostgreSQL data rules](production-database.md).

## 1. Architecture

```
Internet
  │  HTTP (80) → 301 to HTTPS (ACME challenges excepted)      [PROXY_TLS_ENABLED=true]
  │  HTTPS (443) → app
  ▼
proxy   nginx:1.27  ── the ONLY published ports (80, 443). Terminates TLS with
  │     the host's Let's Encrypt certificate (read-only mount) — see §8.
  │     Overwrites X-Real-IP / X-Forwarded-For.
  │     + internal health listener 127.0.0.1:8081 (container loopback, never published)
  │     network: edge
  ▼
app     Next.js standalone (node server.js, uid 1001), port 3000 — not published
  │     networks: edge + backend. Outbound HTTPS allowed (notifications).
  ├──► postgres  16-alpine, volume postgres_data   network: backend (internal)
  └──► redis     7-alpine, rate-limit counters only network: backend (internal)

migrate  one-shot `prisma migrate deploy`, then exits   network: backend (internal)

notifications-worker  retries failed notification deliveries every 60 s
         (migrate image, tsx loop)                  networks: edge + backend
```

`backend` is a Docker `internal` network: PostgreSQL and Redis have no host
port and no route to or from the outside world. The app is reachable only
through nginx, which is what makes trusting `X-Real-IP` safe.

| Service | Published | Restart | Healthcheck | Persistent data |
| --- | --- | --- | --- | --- |
| proxy | `PUBLIC_HTTP_BIND` (default `80`) → 8080, `PUBLIC_HTTPS_BIND` (default `443`) → 8443 | unless-stopped | — (starts after app is healthy; readiness: `scripts/ops/proxy.sh check`) | none (certificates: host `/etc/letsencrypt`, read-only) |
| app | no | unless-stopped | `GET /api/health` every 30 s | none |
| migrate | no | no (one-shot) | exit code | none |
| notifications-worker | no | unless-stopped | — (restarts on crash; see §10a) | none (state lives in PostgreSQL) |
| postgres | no | unless-stopped | `pg_isready` | volume `postgres_data` |
| redis | no | unless-stopped | `redis-cli ping` (authenticated) | none |

All containers log to Docker's json-file driver with rotation
(10 MB × 5 files per container): `docker compose --env-file .env.production logs -f app`.

## 2. Environment

Copy `.env.production.example` to `.env.production` (gitignored and
dockerignored), `chmod 600`, and fill it. The template marks every variable
as required secret / required / optional.

| Variable | Class | Notes |
| --- | --- | --- |
| `APP_URL` | required | `https://<domain>` |
| `AUTH_SECRET` | required secret | ≥ 32 chars, `openssl rand -base64 48` |
| `POSTGRES_PASSWORD` | required secret | `openssl rand -hex 32` (hex: it goes into a URL) |
| `REDIS_PASSWORD` | required secret | `openssl rand -hex 32` |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | required (build time) | digits only; baked into the image |
| `POSTGRES_USER`, `POSTGRES_DB` | optional | default `ms_shelving` |
| `PROXY_TLS_ENABLED` | required | `false` = HTTP bootstrap (before the first certificate); `true` = HTTPS on 443, HTTP redirects. Exactly `true`/`false`, anything else stops the proxy. Apply with `bash scripts/ops/proxy.sh apply` (§8) |
| `PUBLIC_HTTP_BIND`, `PUBLIC_HTTPS_BIND` | optional | defaults `80`, `443`; `127.0.0.1:8080` for HTTP behind a host-level TLS terminator |
| `LETSENCRYPT_DIR`, `ACME_WEBROOT` | optional | host paths mounted read-only into the proxy; defaults `/etc/letsencrypt`, `/var/www/certbot` |
| `SELLER_*` | optional (required before invoices) | confidential banking details |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | optional (token is a secret) | secondary manager channel, sent in parallel with WhatsApp (not conditional on it): order events `order.created`, `order.status_changed`, `order.paid` with redacted text (no customer data), and `contact.created` (new contact-form lead: name, phone, message). Unset = skipped + warn log; orders, payments and leads are never affected. Attempts are stored in `NotificationDelivery`; transient failures are retried automatically by `notifications-worker` (§10a) |
| `SMTP_*`, `MANAGER_EMAIL`, `EMAIL_FROM` | optional (password is a secret) | email channel has no transport yet: reported as unavailable, never as sent |
| `WHATSAPP_NOTIFICATIONS_ENABLED`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ADMIN_RECIPIENT`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_CONTACT_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE`, `WHATSAPP_GRAPH_API_VERSION` | optional, off by default (token is a secret) | internal manager alerts via the official Cloud API, sent FROM the technical Cloud API number (`WHATSAPP_PHONE_NUMBER_ID`, never shown to customers) TO the manager's working/public number (`WHATSAPP_ADMIN_RECIPIENT` — the same number as `NEXT_PUBLIC_WHATSAPP_NUMBER`). Two approved templates: `WHATSAPP_TEMPLATE_NAME` for `order.created` (6 body parameters: order number, customer name, phone, city, total, delivery method) and `WHATSAPP_CONTACT_TEMPLATE_NAME` for `contact.created` (3: customer name, phone, message). Enabled with any required value missing = startup error. Failures are logged as codes and stored in `NotificationDelivery`, and transient ones are retried automatically by `notifications-worker` (§10a); orders and leads are never affected. Never sent to customers |
| `AMOCRM_*`, `BITRIX24_*` | optional (URLs embed credentials) | |
| `PAYMENTS_ENABLED`, `PAYMENTS_PROVIDER` | optional; **leave off** | online payment is not live — §13 |
| `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID`, `NEXT_PUBLIC_YANDEX_METRICA_ID` | optional (build time) | |
| `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_MIN_KEEP` | optional | backup script only |
| `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD` | one-time seed only | command line only, never in the file |

Set by `docker-compose.yml`, not by you: `NODE_ENV=production`,
`TRUSTED_PROXY_CLIENT_IP_HEADER=x-real-ip`, and `DATABASE_URL` / `DIRECT_URL`
/ `REDIS_URL` (assembled from the passwords and private service names).
Development-only: `E2E_BASE_URL`, `NEXT_PUBLIC_APP_URL`, empty
`TRUSTED_PROXY_CLIENT_IP_HEADER`, `STORAGE_*` (unused).

### Fail-closed behaviour

1. **Compose** refuses to start anything if `AUTH_SECRET`, `APP_URL`,
   `POSTGRES_PASSWORD` or `REDIS_PASSWORD` is missing (`${VAR:?}`). There are
   no default secrets.
2. **The app** runs `src/lib/startup/production-config.ts` at startup
   (`src/instrumentation.ts`) and exits with code 1 when:
   `DATABASE_URL` is missing or not PostgreSQL; `AUTH_SECRET` is missing,
   shorter than 32 characters or a template placeholder; `APP_URL` is missing,
   invalid or a placeholder; `TRUSTED_PROXY_CLIENT_IP_HEADER` is missing or
   invalid; `REDIS_URL` is malformed; or **any** variable fails validation
   (for example an empty `SMTP_PASSWORD=`). Previously one invalid variable
   silently switched the process to development mode.
   It also exits when `PAYMENTS_ENABLED=true` but `PAYMENTS_PROVIDER` does not
   name a provider adapter this build contains (§13).
   Warnings (logged, not fatal): no Redis, non-https `APP_URL`,
   `ADMIN_INITIAL_PASSWORD` present at runtime, WhatsApp number not built in,
   `PAYMENTS_ENABLED` set to something other than `true`/`false`.
   Log lines name the variable, never the value. This applies to any
   production-mode start, including a local `npm run start` without
   `NODE_ENV=development` (Playwright sets it; see `playwright.config.ts`).
3. **Health** stays `503` until PostgreSQL answers and the schema matches the
   build (§4), so the proxy never starts in front of an unready app.

## 3. First deploy

1. **Provision** a Linux server (Ubuntu 24.04 LTS or similar, 2 vCPU / 4 GB
   RAM / 40 GB SSD is ample). Install Docker Engine + Compose plugin from
   Docker's repository. Create a non-root deploy user in the `docker` group.
   Enable automatic security updates.
2. **Firewall**: allow inbound 22 (restricted to your IPs if possible), 80,
   443 only. Docker-published ports bypass `ufw`; that is why only the proxy
   publishes ports at all.
3. **DNS**: point the domain's **A** record (and `www`'s, if used) at the
   server. **No AAAA record** for the first release (§8.7). TLS is enabled
   after the first deploy, following §8.
4. **Code**: `git clone` into `/opt/ms-shelving` and check out the release commit.
5. **Env**: `cp .env.production.example .env.production && chmod 600 .env.production`,
   fill it in (§2).
   Keep `PROXY_TLS_ENABLED=false` for now (HTTP bootstrap).
6. **Backup directory**: `sudo mkdir -p /var/backups/ms-shelving && sudo chown <deploy-user> /var/backups/ms-shelving`.
   **ACME webroot**: `sudo mkdir -p /var/www/certbot`.
7. **Deploy** (tests the proxy config, builds images, starts PostgreSQL +
   Redis, runs migrations, starts the app, waits for health, starts nginx in
   HTTP bootstrap mode, verifies internal readiness):
   ```sh
   bash scripts/ops/deploy.sh --first-deploy
   ```
7a. **Enable HTTPS now** — §8.2 to §8.5 (certificate, `PROXY_TLS_ENABLED=true`,
   `proxy.sh apply`, verification). Do the remaining steps over HTTPS: admin
   login needs it (`Secure` cookies).
8. **Seed the catalog and the first admin — once.** `prisma/seed.ts` is
   idempotent and refuses a weak or default admin password in production.
   Its catalog prices are placeholders: correct them in `/admin/prices` before launch.
   It seeds **no promo codes** in production: the demo codes in
   `src/lib/data/seed-data.ts` are public and development-only. A promo code
   stops being accepted once its `validUntil` instant has passed (server time).
   ```sh
   read -r ADMIN_EMAIL; read -rs ADMIN_INITIAL_PASSWORD; export ADMIN_EMAIL ADMIN_INITIAL_PASSWORD
   docker compose --env-file .env.production run --rm --no-deps \
     -e ADMIN_EMAIL -e ADMIN_INITIAL_PASSWORD migrate ./node_modules/.bin/tsx prisma/seed.ts
   unset ADMIN_INITIAL_PASSWORD
   ```
9. **Verify** health, pages, network exposure, HTTPS/redirect and admin
   login, then log in through the browser and change the initial password.
   With `PROXY_TLS_ENABLED=true` the smoke test targets `APP_URL` by default:
   ```sh
   SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... bash scripts/ops/smoke-test.sh
   ```
10. **Critical public flows by hand**: open `/configurator`, change sections /
    height, confirm the price updates; add to cart; submit a test order;
    open it in `/admin/orders`; generate the commercial proposal PDF (and the
    invoice once `SELLER_*` is set). Cancel the test order afterwards.
11. **Backups**: install the timer (see [production-backups.md](production-backups.md)),
    run one backup manually, and do a restore test.

## 4. Migrations

- `prisma migrate deploy` is the only schema command used in production. It
  applies committed migrations from `prisma/migrations/`. Never `db push`,
  `migrate dev` or `migrate reset` (`npm run db:reset`) against production.
- It runs in the separate `migrate` image. The app never migrates, so there
  is exactly one migrator no matter how many app containers exist; Prisma
  also holds a PostgreSQL advisory lock while migrating.
- `docker-compose.yml`: the app `depends_on` migrate with
  `service_completed_successfully`, so even a bare `docker compose up -d`
  migrates first and does not start the app when migration fails.
- `/api/health` returns `503` (`"schema":"pending"` or `"failed"`) when any
  migration shipped in the image is not applied in the database, so an app
  cannot report ready against an older schema. Extra, newer migrations in the
  database are accepted (application rollback, §6).
- **Write migrations expand → contract.** During a deploy the previous app
  version keeps serving while the migration runs, and a rollback runs an
  older app against the new schema. So: add nullable columns/tables first;
  backfill; switch code; drop old columns only in a later release.

### Failed migration

`deploy.sh` stops; the app is not restarted and the old version keeps
serving. Prisma runs each migration in a transaction where PostgreSQL allows
it, so usually nothing was applied — but Prisma records the migration as
failed, so `/api/health` reports `503` with `"schema":"failed"` (the app keeps
serving traffic; nginx does not use the healthcheck) and every later
`migrate deploy` refuses to run until it is resolved. That alert is intended. Then:

1. Read the error in the deploy output (`docker compose ... logs migrate` is
   gone with `--rm`; rerun `docker compose --env-file .env.production run --rm --no-deps migrate` to see it again).
2. Check state: `docker compose --env-file .env.production run --rm --no-deps migrate ./node_modules/.bin/prisma migrate status`.
3. Fix forward with a corrected new release. If Prisma recorded the migration
   as failed, and you have verified nothing of it was applied, mark it:
   `docker compose --env-file .env.production run --rm --no-deps migrate ./node_modules/.bin/prisma migrate resolve --rolled-back <migration_name>`
   (works with the currently deployed migrate image; health returns to `ok`).
   If it was partly applied (non-transactional statements), repair manually or
   restore the pre-deploy backup (next point).
4. The pre-deploy backup taken by `deploy.sh` is the last resort — see
   [production-backups.md](production-backups.md).

## 5. Normal deploy

```sh
cd /opt/ms-shelving
git fetch && git checkout <release-commit>
bash scripts/ops/deploy.sh
SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... bash scripts/ops/smoke-test.sh
```

`deploy.sh`: validate config → **test the proxy config** for the current
`PROXY_TLS_ENABLED` in a throwaway container (`nginx -t`, including the
certificate; aborts before anything changes) → **backup** (aborts the deploy
if it fails) → build `ms-shelving-app:<commit>` and
`ms-shelving-migrate:<commit>` → start PostgreSQL/Redis → **migrate** (aborts
on failure) → recreate the app and wait for `/api/health` → recreate nginx
from this release's `deploy/nginx/` → (re)start `notifications-worker` on the
new migrate image → **internal readiness** (below) → tag the release `:latest`
and append it to `.deploy/history`.

Internal readiness (`proxy_ready`, also `bash scripts/ops/proxy.sh check`)
runs `deploy/nginx/readiness.sh` inside the proxy: the proxy container is
running, and nginx → app → `/api/health` succeeds through the proxy's
loopback-only listener `127.0.0.1:8081`, which is never redirected to HTTPS.
With TLS enabled it also requests `/api/health` through the TLS listener with
the `APP_URL` host as SNI, verifying the certificate. It needs no DNS. The
public check (DNS, real certificate, redirect) is `smoke-test.sh`.

Expect a few seconds of `502` while the app container is replaced (single
instance) and a ~1 s gap while nginx is recreated. nginx re-resolves the
app's address itself (`resolver` + `server app:3000 resolve`).

## 6. Rollback

**Application rollback** (the normal case — bad code, schema compatible):

```sh
cat .deploy/history                     # previous tags
bash scripts/ops/rollback-app.sh <previous-tag>
```

Starts the previous image without running migrations or rebuilding; the
database is untouched. `notifications-worker` is moved to the same tag's
migrate image (or stopped, with a warning, if that release predates it). Old images stay on the host until you prune them
(`docker image ls ms-shelving-app`); keep at least the last 3 releases.

**Database rollback is never automatic.** Migrations are not rolled back by
any script. If a released migration turns out to be wrong:

- *Backward compatible* (the common, expand-style case): roll back the app
  only, then fix forward with a new migration in the next release.
- *Backward incompatible* (the old app cannot work with the new schema — a
  dropped/renamed column, a changed type): do not roll back the app alone.
  Either (a) fix forward quickly with a new release, or (b) write and review a
  new forward migration that restores the old shape, or (c) restore the
  pre-deploy backup into a new database and promote it
  ([production-backups.md](production-backups.md)) — this **loses every order
  and change written since the backup**, so export those first
  (compare `Order.createdAt` / `AuditLog.createdAt` after the backup time).
  Choose (c) only when (a) and (b) are impossible.

## 7. Redis

Redis holds only rate-limit counters with 60-second windows. It is not a
source of business data and is not backed up.

- Persistence is disabled (`--save "" --appendonly no`, no volume). A
  restart opens fresh windows; nothing else is lost.
- Private: `backend` internal network, no published port, `--requirepass`.
- Bounded: `--maxmemory 128mb --maxmemory-policy volatile-ttl` (every key has
  a TTL; under memory pressure the keys closest to expiry go first).
- When Redis is down: public limits continue per app instance from memory;
  **admin login returns 503** until Redis is back; existing admin sessions
  keep working; the app logs `[rate-limit] Redis unavailable` at most once a minute.
- **Health does not depend on Redis**, deliberately. A Redis outage leaves the
  storefront, pricing and checkout working; failing health would make Docker
  and `deploy.sh` treat it as a dead site, and restarting the app would not
  fix Redis. Redis has its own container healthcheck:
  `docker compose --env-file .env.production ps redis`.

## 8. TLS, domain and proxies

No domain or certificate is configured in the repository. The contract:

- `APP_URL` = the exact public `https://` origin.
- The app sends HSTS (`max-age=63072000; includeSubDomains; preload`) and
  CSP `upgrade-insecure-requests` in production. **Serve the domain over
  HTTPS before pointing browsers at it**, and only keep `includeSubDomains`
  if every subdomain is HTTPS.
- Session cookies are `Secure` in production: admin login needs HTTPS (or `localhost`).

**Option A — nginx terminates TLS (the repository default for v1).** Certbot
runs on the host in webroot mode; the `proxy` container reads the certificate
from a read-only mount. `$remote_addr` is the real client, so the client-IP
contract is unchanged. Placeholders below: `<domain>` = the host of
`APP_URL` (e.g. `example.kz`), `<ops-email>` = the address Let's Encrypt
sends expiry warnings to.

### 8.1 How it is wired (no hand-edited tracked files)

The mode is one line in `.env.production` (untracked):
`PROXY_TLS_ENABLED=false|true`. At every start the proxy's entrypoint
(`deploy/nginx/entrypoint.sh`) renders `/etc/nginx/conf.d/default.conf` from a
tracked file. `docker-compose.yml`, `deploy/nginx/*` and the scripts are never
edited on the server; any `docker compose --env-file .env.production …`
command produces the same proxy.

| | `PROXY_TLS_ENABLED=false` (bootstrap) | `PROXY_TLS_ENABLED=true` |
| --- | --- | --- |
| Config | `deploy/nginx/http.conf` | `deploy/nginx/https.conf.template`, `${TLS_DOMAIN}` = `APP_URL` host |
| Port 80 | app + `/.well-known/acme-challenge/` | `/.well-known/acme-challenge/` from the webroot; **everything else `301 https://<domain>$request_uri`** (fixed target, the client's `Host` is never reflected) |
| Port 443 | published, nothing listens | TLS 1.2/1.3, HTTP/2, Let's Encrypt certificate; `Host: <domain>` → app; any other Host (`www.<domain>`, bare IP) → `301 https://<domain>…` |
| `127.0.0.1:8081` (inside the container, never published) | `/api/health` → app, no redirect | same |
| Certificate | not needed | `/etc/letsencrypt/live/<domain>/{fullchain,privkey}.pem` |

Both modes forward to the app through the same `deploy/nginx/app-proxy.conf`,
so the `X-Real-IP` / `X-Forwarded-For` overwrite is identical on HTTP, HTTPS
and the health listener. `X-Forwarded-Proto` is `https` behind 443. HSTS stays
the app's (`next.config.ts`); nginx neither removes nor duplicates it.

The entrypoint **fails closed**: `PROXY_TLS_ENABLED` other than `true`/`false`,
an `APP_URL` that is not `https://<host>` (no port, no path), or a missing
certificate stops the container with a one-line reason.

Mounts (all read-only): `deploy/nginx` → `/etc/nginx/ms-shelving`,
`/etc/letsencrypt` → `/etc/letsencrypt` (the whole directory: `live/` links
into `archive/`), `/var/www/certbot` → `/var/www/certbot`. Certificates and
keys live only on the host and are never in git (`*.pem`, `*.key` are
gitignored and dockerignored).

### 8.2 First deploy and DNS readiness

1. Deploy with `PROXY_TLS_ENABLED=false` (§3 step 7). The site answers on
   plain HTTP. Keep this window short and do not announce the site yet.
2. Create the DNS **A** record for `<domain>` (and for `www.<domain>` if you
   want www to redirect to the canonical host). No AAAA (§8.7).
3. Wait until DNS points at this server, from outside the server:
   ```sh
   dig +short A <domain>        # must print this server's public IPv4
   dig +short A www.<domain>    # only if www is used
   dig +short AAAA <domain>     # must print nothing
   ```
4. Prove the challenge path works through DNS before asking Let's Encrypt:
   ```sh
   sudo mkdir -p /var/www/certbot/.well-known/acme-challenge
   echo ok | sudo tee /var/www/certbot/.well-known/acme-challenge/probe
   curl -fsS http://<domain>/.well-known/acme-challenge/probe   # → ok
   sudo rm /var/www/certbot/.well-known/acme-challenge/probe
   ```

### 8.3 First certificate (Certbot, webroot)

Install certbot on the host (`sudo apt install certbot` on Ubuntu; the
package installs a `certbot.timer` that renews automatically). Rehearse
against the staging CA first, then issue for real. Drop `-d www.<domain>`
if www is not used. `--cert-name <domain>` fixes the path the proxy reads.

```sh
sudo certbot certonly --webroot -w /var/www/certbot \
  --cert-name <domain> -d <domain> -d www.<domain> \
  --email <ops-email> --agree-tos --no-eff-email \
  --deploy-hook "bash /opt/ms-shelving/scripts/ops/proxy.sh reload" \
  --dry-run

sudo certbot certonly --webroot -w /var/www/certbot \
  --cert-name <domain> -d <domain> -d www.<domain> \
  --email <ops-email> --agree-tos --no-eff-email \
  --deploy-hook "bash /opt/ms-shelving/scripts/ops/proxy.sh reload"

sudo ls /etc/letsencrypt/live/<domain>/     # fullchain.pem privkey.pem …
```

Certbot stores the `--deploy-hook` in `/etc/letsencrypt/renewal/<domain>.conf`,
so every future renewal runs it. Right after this first issuance it runs once
against the still-HTTP proxy, which is harmless.

### 8.4 Enable TLS

```sh
cd /opt/ms-shelving
sed -i 's/^PROXY_TLS_ENABLED=.*/PROXY_TLS_ENABLED=true/' .env.production
grep -E '^(APP_URL|PROXY_TLS_ENABLED)=' .env.production   # APP_URL="https://<domain>"
bash scripts/ops/proxy.sh apply
```

`proxy.sh apply` first renders and tests the new configuration with
`nginx -t` in a throwaway container (which loads the certificate). If that
fails, the running proxy is **not touched** and the site stays up on HTTP.
Otherwise it recreates the proxy (~1 s gap) and runs the internal readiness
check, including the TLS listener. Every later `deploy.sh` keeps TLS, because
the mode lives in `.env.production`.

### 8.5 Verify HTTPS

```sh
bash scripts/ops/smoke-test.sh          # BASE_URL defaults to APP_URL when TLS is on
curl -sSI http://<domain>/catalog       # 301 → https://<domain>/catalog
curl -sSI https://www.<domain>/         # 301 → https://<domain>/ (if www is used)
curl -sSI https://<domain>/ | grep -i strict-transport-security
```

The smoke test refuses an `http://` `BASE_URL` while TLS is on. With an
`https://` `BASE_URL` it also checks the HTTP→HTTPS redirect, that
`/.well-known/acme-challenge/` stays on plain HTTP (needed by renewals) and
HSTS. curl verifies the certificate on every request. Run it from a machine
outside the server as well, or use an external TLS checker.

### 8.6 Renewal and the nginx reload hook

- `certbot.timer` (twice a day) runs `certbot renew`. It renews within 30
  days of expiry via the same webroot, which the proxy keeps serving on HTTP.
- After a **successful** renewal certbot runs the deploy hook
  `bash /opt/ms-shelving/scripts/ops/proxy.sh reload` as root. It runs
  `nginx -t` inside the running proxy and then a graceful `nginx -s reload`:
  no container restart, no dropped connections. If `nginx -t` rejects the new
  files, nginx is **not** reloaded and keeps serving the previous (still
  valid) certificate; the hook exits non-zero and certbot logs it in
  `/var/log/letsencrypt/letsencrypt.log`.
- Check the setup:
  ```sh
  systemctl list-timers certbot.timer
  sudo grep renew_hook /etc/letsencrypt/renewal/<domain>.conf
  sudo certbot renew --dry-run                       # challenge path works
  sudo bash /opt/ms-shelving/scripts/ops/proxy.sh reload   # hook works
  ```
- If the server was installed with the snap package instead, its
  `snap.certbot.renew.timer` does the same; the hook is identical.
- Monitor `https://<domain>/api/health` externally; an expiring certificate
  makes it fail before visitors notice.

### 8.7 IPv6

Keep **no AAAA record** for the first release. Docker publishes 80/443 on
IPv6 too, but with Docker's default userland proxy an IPv6 client reaches
nginx with the Docker gateway as `$remote_addr`. Every IPv6 visitor would
then share one rate-limit bucket and the audit log would store no real
address. Before adding AAAA, verify the IPv6 → nginx client-IP path (e.g.
IPv6 enabled on the `edge` network with `userland-proxy: false`, then
`smoke-test.sh --check-ip-contract` over IPv6). Until then you may also bind
IPv4 only: `PUBLIC_HTTP_BIND="0.0.0.0:80"`, `PUBLIC_HTTPS_BIND="0.0.0.0:443"`.

### 8.8 Rollback when the TLS configuration or certificate is broken

- **`proxy.sh apply` or `deploy.sh` reports the proxy config invalid:**
  nothing was changed (the test runs in a throwaway container). Read the
  one-line reason (missing certificate, `APP_URL` not `https://<host>`, bad
  `PROXY_TLS_ENABLED`), fix it, rerun.
- **The proxy is up but HTTPS is broken** (deleted or corrupted certificate,
  failed readiness after apply): return to HTTP immediately, then fix:
  ```sh
  sed -i 's/^PROXY_TLS_ENABLED=.*/PROXY_TLS_ENABLED=false/' .env.production
  bash scripts/ops/proxy.sh apply
  ```
  Browsers that already received HSTS will refuse plain HTTP for this domain,
  so treat this as a short emergency state. Re-issue or restore the
  certificate (§8.3), then enable TLS again (§8.4).
- **A bad release changed `deploy/nginx/*`:** `git checkout <previous-release>`
  and `bash scripts/ops/proxy.sh apply`, or deploy the previous release.

**Option B — a CDN / load balancer terminates TLS (e.g. Cloudflare later).**
nginx then sees the CDN's address as `$remote_addr`, so every visitor would
share one rate-limit bucket. Required changes, all in nginx (the app still
reads only `X-Real-IP`):

1. `set_real_ip_from` for each of the CDN's **published** IP ranges (keep them
   updated), `real_ip_header CF-Connecting-IP;` (or the provider's
   equivalent), `real_ip_recursive off;`.
2. Allow inbound 80/443 **only from those ranges** (host firewall or the
   provider's origin lock), otherwise anyone can bypass the CDN and forge the header.
3. Keep `proxy_set_header X-Real-IP $remote_addr;` — after the realip module,
   `$remote_addr` is the validated client address.
4. `X-Forwarded-Proto` must reflect the client's scheme: use full (strict)
   TLS to the origin, or map the CDN's scheme header in nginx.

Never trust `X-Forwarded-For`, `CF-Connecting-IP` or similar from arbitrary
sources. Details: [production-client-ip-and-rate-limiting.md](production-client-ip-and-rate-limiting.md).

## 9. Build reproducibility and fonts

- The image builds without a database (`next build` needs none).
- `NEXT_PUBLIC_*` values are compiled into the bundle: pass them at build
  time (Compose does, from `.env.production`). Changing the WhatsApp number
  needs a rebuild (`deploy.sh`).
- **Outbound network is required during `docker build`**: `npm ci` (npm
  registry, Prisma engine download) and `next/font/google`, which downloads
  Inter and IBM Plex Mono from `fonts.googleapis.com` /
  `fonts.gstatic.com`. The downloaded files are self-hosted in the image
  (`/_next/static/media`); **the running site makes no request to Google**.
  The repository contains only Noto Sans (used for PDFs), which would change
  the storefront's typography, so the fonts were not switched to
  `next/font/local`. To make builds fully offline later, add the OFL-licensed
  Inter and IBM Plex Mono files (from their official releases) to the
  repository and switch `src/app/layout.tsx` to `next/font/local`.
- Base images float within a major line (`node:22-alpine`, `postgres:16-alpine`,
  `redis:7-alpine`, `nginx:1.27-alpine`) to receive security patches; pin
  digests if you need bit-for-bit rebuilds.

## 10. Logging

- API routes log unexpected errors in production as one line,
  `[api] internal error: <ErrorClass> code=<P2002|ECONNREFUSED…>` — no message,
  so no connection strings or customer fields.
- Startup configuration problems: `[startup] FATAL|WARNING: <variable> …`.
- Redis outage: `[rate-limit] Redis unavailable (…)` (no URL or password).
- Missing client-IP configuration: `[client-ip] …`.
- nginx access logs contain client IPs and request paths (personal data under
  most privacy laws); container log rotation bounds retention.
- Seller banking details, passwords and secrets are not logged by the app or
  by `scripts/ops`. Never run the scripts with `bash -x`.

## 10a. Notification retries (`notifications-worker`)

A failed notification (Telegram, WhatsApp) never affects the order or the
contact-form lead (`ContactLead`, listed in `/admin/leads`). A new order or
lead and its `PENDING` rows in `NotificationDelivery` (one per available
channel, with a 5-minute lease in `nextAttemptAt`) are written in ONE database
transaction: either both exist or neither does. After commit the web app makes
one attempt in the background and turns each row into `SENT` or `FAILED`; if
the app dies before or during that attempt, the `PENDING` row becomes due when
the lease runs out and the worker sends it. (Admin status-change events have no
business transaction to join; their rows are written right after the update.)
Due rows are retried by one dedicated
container, `notifications-worker`. There is no queue broker: the table is
the queue, and the worker is a 60-second loop
(`tsx scripts/notification-retry-worker.ts`) in the migrate image. The app
itself never retries.

- **Which errors retry:** `TIMEOUT`, `NETWORK_ERROR`, HTTP 408, 429 and 5xx,
  Meta's temporary/rate-limit error codes (1, 2, 4, 80007, 130429, 131000,
  131016, 131048, 131056, 133004), `ORDER_LOOKUP_FAILED`, `LEAD_LOOKUP_FAILED`,
  `ADAPTER_ERROR`. Every other code (e.g. `HTTP_400_META_132001`, template not
  found; `HTTP_401`, bad token; `ORDER_NOT_FOUND`, `LEAD_NOT_FOUND`) is
  permanent and never retried.
- **Schedule:** at most 6 attempts in total. The first retry comes 1 min after
  the original send, then 5 min, 15 min, 1 h and 3 h (last retry ≈ 4 h 20 min
  after the order). Rows older than 24 h are never retried.
- **Duplicate protection:** only `FAILED` rows and lease-expired `PENDING`
  rows with a due `nextAttemptAt` are read, so a `SENT` row is never resent.
  The worker claims each row (a conditional update that pushes `nextAttemptAt`
  5 min ahead) before sending. That stops a crashed pass or a second worker
  from resending in a tight loop. WhatsApp additionally never sends
  `order.created` twice for one order, nor `contact.created` twice for one
  lead. (A `PENDING` row recovered after a crash is at-least-once: if the app
  died after Meta accepted the message but before recording it, the manager
  may get that one alert twice.)
- **Channel disabled/unconfigured at retry time:** the row is postponed 1 h
  without spending an attempt, until the 24 h limit ends it.
- **Final state:** a row that will not be retried stays `FAILED` with
  `nextAttemptAt` NULL and its last error code (`EXPIRED` for a `PENDING` row
  older than 24 h).

The worker gets the same notification variables as `app` (docker-compose.yml)
and refuses to start without PostgreSQL or with an incomplete WhatsApp
configuration.

| Task | Command |
| --- | --- |
| Worker logs | `docker compose --env-file .env.production logs -f --tail 200 notifications-worker` |
| Restart worker | `docker compose --env-file .env.production up -d --no-deps --no-build notifications-worker` |
| One pass by hand | `docker compose --env-file .env.production run --rm --no-deps notifications-worker ./node_modules/.bin/tsx scripts/notification-retry-worker.ts --once` |
| Pending retries | `docker compose --env-file .env.production exec postgres psql -U ms_shelving -d ms_shelving -c 'SELECT channel, event, "orderNumber", "contactLeadId", status, attempts, "lastError", "nextAttemptAt" FROM "NotificationDelivery" WHERE status IN ('"'"'FAILED'"'"', '"'"'PENDING'"'"') ORDER BY "createdAt" DESC LIMIT 20;'` |

Log lines are codes only: `[notifications] retry failed|retry gave up|retry
postponed|retry abandoned event=… channel=… order=…|lead=<id> error=… attempt=…` and
`[notifications-worker] started|stopped|retried deliveries sent=N|pass failed error=<ErrorClass>`.

## 11. Routine operations

| Task | Command (from `/opt/ms-shelving`) |
| --- | --- |
| Status | `docker compose --env-file .env.production ps` |
| Logs | `docker compose --env-file .env.production logs -f --tail 200 app` |
| Health (internal) | `docker compose --env-file .env.production exec proxy wget -qO- http://127.0.0.1:8081/api/health` or `bash scripts/ops/proxy.sh check` |
| Health (public) | `curl -fsS https://<domain>/api/health` |
| Certificate expiry | `sudo certbot certificates` |
| Restart app | `docker compose --env-file .env.production restart app` |
| Stop everything (data kept) | `docker compose --env-file .env.production down` (never add `-v`: it deletes the database volume) |
| Rotate `AUTH_SECRET` | edit the file, `docker compose --env-file .env.production up -d --no-deps app` (signs out all admins) |
| Revoke one admin's sessions | `docker compose --env-file .env.production run --rm --no-deps migrate npm run admin:revoke-sessions -- --email <address>` |
| Revoke every admin's sessions | same command with `-- --all` (keeps `AUTH_SECRET` intact) |
| Rotate `REDIS_PASSWORD` | edit the file, `docker compose --env-file .env.production up -d --no-deps redis app` |
| Rotate `POSTGRES_PASSWORD` | `ALTER USER ms_shelving PASSWORD '<new>'` via `exec postgres psql -U ms_shelving -d ms_shelving`, then edit the file, then `up -d --no-deps app` |
| Disk usage | `docker system df`; prune only unused images older than your rollback window |

### Revoking admin sessions

Admin sessions are signed, stateless cookies with an 8-hour lifetime
(`src/lib/auth/session.ts`), so there is no session row to delete. Each admin
instead carries a `User.sessionVersion`, stamped into every token issued to
them; `src/lib/auth/revocation.ts` refuses any token whose version is behind
the current one, on the very next request. Bumping that counter therefore
kills every cookie that admin holds — on every device — at once:

```sh
docker compose --env-file .env.production run --rm --no-deps migrate   npm run admin:revoke-sessions -- --email manager@example.kz
```

Do this after a password change, a departure, or any suspected cookie leak.
Rotating `AUTH_SECRET` (table above) is the bigger hammer: it invalidates
every admin's sessions at once, and is the right response only when the
signing key itself may have leaked.

Deactivating an admin (`User.active = false`) has the same immediate effect,
and so does changing their role: a token whose role no longer matches the
database is refused rather than carrying stale privileges until it expires.

## 12. Before renting the real server — remaining decisions

- Domain and DNS A record(s); then the TLS bootstrap in §8.
- Off-host copies of backups (see [production-backups.md](production-backups.md)) — local backups do not survive loss of the server.
- Real `SELLER_*`, WhatsApp number, notification credentials; real catalog prices.
- External uptime monitoring of `https://<domain>/api/health` and of backup age.
- Whether online payment is wanted at launch at all (§13) — it is off today.

## 13. Online payment

**Status: not live, and cannot be switched on by configuration.** Checkout
uses the three offline methods (bank transfer, invoice, cash), each confirmed
by a manager. What exists is the foundation underneath a future provider:

- A `Payment` table — one row per payment *attempt*, so an order can be
  attempted more than once without losing the history of the earlier tries.
  Its amount is always copied from the order's own stored total.
- `PaymentStatus`: `PENDING` → `PAID` | `FAILED` | `CANCELLED` | `EXPIRED`.
- A two-method provider interface (`src/lib/payments/provider.ts`) and an
  **empty** adapter registry (`src/lib/payments/registry.ts`).
- `POST /api/payments`, which answers **404** while payment is unavailable.

### Why it cannot be switched on

`PAYMENTS_ENABLED=true` resolves a provider through the registry. The registry
is empty, so the production preflight treats that as a fatal misconfiguration
and the server exits rather than start a shop that advertises an online
payment it cannot take. Nothing fakes a success anywhere in the path: a
disabled or unconfigured provider returns a typed failure, never a payment.

### Turning it on later

1. Obtain the official merchant details from the provider. Until those exist
   nothing here should be guessed — no endpoint, credential name, callback
   format or service identifier for any provider appears in this repository.
2. Write `src/lib/payments/providers/<name>.ts` implementing `PaymentProvider`.
   Read its credentials from its own server-only environment variables inside
   the factory. Add those variable names to `.env.production.example`; never
   the values.
3. Register the adapter in `src/lib/payments/registry.ts`.
4. Set `PAYMENTS_ENABLED=true` and `PAYMENTS_PROVIDER=<name>`.

Nothing else in the flow changes: the amount still comes from the order, the
idempotency guard still lives in the database (`Payment.pendingKey`), and
`PAID` still requires the `PAYMENT_PROVIDER` channel of the order status
policy (`src/lib/orders/status-transitions.ts`).

### The security boundary, in one paragraph

A browser can ask for a payment to be *started* for an order number, and that
is all. It cannot name an amount (the request schema is `.strict()` and the
service takes no amount parameter), cannot choose a provider, and cannot mark
anything paid. `PAID` is produced only by `confirmPaymentWithProvider()`,
which asks the provider server-to-server and which no public route calls; the
order then moves to `PAID` through the same transition policy, compare-and-swap
and audit trail the admin panel uses.
