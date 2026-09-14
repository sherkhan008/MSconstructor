# PostgreSQL backups and restore

PostgreSQL is the only authoritative store: catalog, prices and price
history, customers, orders, order snapshots, issued documents, admin users,
audit log. Redis holds only rate-limit counters and is not backed up
([production-deployment.md](production-deployment.md), §7).

Scripts: `scripts/ops/backup-postgres.sh`, `scripts/ops/restore-postgres.sh`.
Schedule: `deploy/systemd/ms-shelving-backup.{service,timer}`.

## Backups

```sh
bash scripts/ops/backup-postgres.sh
```

What it does:

1. `pg_dump --format=custom --compress=6` **inside the `postgres` container**
   over its local socket — no password is passed, typed or printed, and
   `pg_dump` always matches the server version.
2. Streams to `BACKUP_DIR/ms_shelving_<UTC>.dump.partial` on the host (`umask 077`, directory `700`).
3. Reads the whole archive back with `pg_restore` (detects truncation or
   corruption) and checks it contains `_prisma_migrations`.
4. Writes `<name>.dump.sha256`, renames `.partial` → `.dump`, writes the name
   to `BACKUP_DIR/LATEST`.
5. Prunes (see retention). Any failure exits non-zero with `[backup] ERROR: …`
   on stderr and leaves no file that looks like a good backup.

It is also run automatically by `scripts/ops/deploy.sh` before every
normal deploy; a failed backup aborts the deploy.

| Setting | Default | Meaning |
| --- | --- | --- |
| `BACKUP_DIR` | `/var/backups/ms-shelving` | Host directory — outside the repository and outside Docker volumes, so `docker compose down -v` or deleting a container never touches it |
| `BACKUP_RETENTION_DAYS` | `14` | Backups older than this are deleted |
| `BACKUP_MIN_KEEP` | `7` | The newest N backups are never deleted, whatever their age |

### Retention policy (v1)

Daily backups at 02:30, plus one before each deploy. Keep 14 days; always keep
at least the 7 newest. Pruning runs only after a successful backup (a failing
backup job therefore never deletes the last good backups), only inside
`BACKUP_DIR`, and only on files matching `ms_shelving_<digits>T<digits>Z.dump`
(plus their `.sha256`). Other files in the directory are never touched.
Size reference: the seeded catalog with a few orders is ~85 KB compressed.

### Schedule (systemd)

```sh
sudo cp deploy/systemd/ms-shelving-backup.service deploy/systemd/ms-shelving-backup.timer /etc/systemd/system/
# edit WorkingDirectory/ExecStart if the checkout is not /opt/ms-shelving
sudo systemctl daemon-reload
sudo systemctl enable --now ms-shelving-backup.timer
sudo systemctl start ms-shelving-backup.service   # run one now
systemctl list-timers ms-shelving-backup.timer
journalctl -u ms-shelving-backup.service -n 50
```

Cron alternative (mails output on failure when `MAILTO` works):
`30 2 * * * cd /opt/ms-shelving && bash scripts/ops/backup-postgres.sh`

### Making failures visible

- `systemctl --failed` shows a failed backup unit; wire `OnFailure=` to your
  alerting if you have one.
- Monitor backup age, independent of the job itself — alert when the newest
  file is older than 26 hours:
  `find /var/backups/ms-shelving -name 'ms_shelving_*.dump' -mmin -1560 | grep -q .`

### Off-host copies — required before launch

Backups on the same disk do not survive loss of the server. Copy
`BACKUP_DIR` to storage in a different failure domain at least daily (another
server via `rsync`/`restic` over SSH, or an object-storage bucket of your
choice). Encrypt copies that leave the host: dumps contain customer contact
data and admin password hashes. This repository deliberately does not pick a
storage vendor.

## Restore

A backup counts only once a restore has been tested. Repeat the test after
any schema-heavy release and at least quarterly.

### 1. Restore into a new database (never over the live one)

```sh
bash scripts/ops/restore-postgres.sh /var/backups/ms-shelving/ms_shelving_20260914T023000Z.dump ms_shelving_restored
```

The script verifies the `.sha256`, refuses the live database name and any
existing database, creates the new database, runs `pg_restore --no-owner
--no-privileges --exit-on-error --single-transaction`, then verifies there are
no unfinished migrations, lists applied migrations and prints row counts
(counts only — no customer data). A failed restore leaves an empty database
you can drop.

For a restore **test**, inspect it and drop it afterwards:
`docker compose --env-file .env.production exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE ms_shelving_restored"'`.

### 2. Promote (disaster recovery only — deliberate, manual)

Promotion replaces the data the app serves. Everything written after the
backup was taken is not in it. The old database is renamed, never dropped.

```sh
docker compose --env-file .env.production stop proxy app
docker compose --env-file .env.production exec -T postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres' <<'SQL'
ALTER DATABASE ms_shelving RENAME TO ms_shelving_replaced_20260914;
ALTER DATABASE ms_shelving_restored RENAME TO ms_shelving;
SQL
docker compose --env-file .env.production run --rm --no-deps migrate ./node_modules/.bin/prisma migrate status
bash scripts/ops/deploy.sh --first-deploy     # migrate (applies only what is newer than the backup), app, proxy
bash scripts/ops/smoke-test.sh
```

Keep `ms_shelving_replaced_*` until the restored system is confirmed good,
then take a fresh backup before dropping it.

### New server from a backup

Provision and configure as in the runbook, copy the backup file and its
`.sha256` into `BACKUP_DIR`, `docker compose --env-file .env.production up -d --wait postgres redis`,
then steps 1 and 2 above. The fresh `postgres` volume's empty `ms_shelving`
database is what gets renamed away.

## Verified restore test (local, disposable)

Performed on 2026-09-14 with Docker Desktop, using two throwaway Compose
projects with their own volumes and random secrets (the developer's local
database was not touched):

1. Stack A: `deploy.sh --first-deploy`, seed, two orders (individual and
   legal entity), one issued commercial-proposal PDF, admin logins.
2. `backup-postgres.sh` → 83,953-byte dump, read-back verified, checksum OK;
   retention pruned exactly the 3 planted files beyond the 7 newest that were
   older than 14 days and left unrelated files alone.
3. Stack B (fresh volume, different passwords): `restore-postgres.sh` into
   `ms_shelving_restored` → 4 applied migrations, 0 unfinished; User 1,
   ProductModel 3, Component 134, Customer 2, Order 2, OrderItem 2,
   OrderDocument 1, AuditLog 3. Refused the live name and an existing database.
4. Promoted as above; `prisma migrate status`: up to date; `deploy.sh
   --first-deploy`: "No pending migrations"; `/api/health` → `schema: ok`.
5. The app served the restored data: login with stack A's admin credentials,
   both order numbers in `/admin/orders`, order detail page 200, the issued
   PDF re-rendered **byte-identical** to the original, new orders accepted.
6. Negative checks: truncated dump with checksum → "checksum mismatch";
   truncated dump without checksum → `pg_restore` error, empty database left;
   backup with PostgreSQL stopped → exit 1, no file written.
