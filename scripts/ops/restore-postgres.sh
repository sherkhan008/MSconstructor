#!/usr/bin/env bash
# ==============================================================================
# Restore a backup into a NEW database and verify it. See docs/production-backups.md.
#
#   scripts/ops/restore-postgres.sh <backup.dump> <new_database_name>
#
# Never overwrites anything: refuses the live POSTGRES_DB name and any
# database that already exists. The restore runs in a single transaction and
# stops at the first error, so a failed restore leaves an empty database that
# can simply be dropped. Promoting the restored database to live is a
# separate, deliberate manual step (docs/production-backups.md, "Promote").
# ==============================================================================
OPS_NAME=restore
# shellcheck source=scripts/ops/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

[ "$#" -eq 2 ] || die "usage: $0 <backup.dump> <new_database_name>"
dump="$1"
target="$2"

require_env_file
[ -f "$dump" ] || die "backup file not found: $dump"
[[ "$target" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "database name must match ^[a-z_][a-z0-9_]{0,62}$"
case "$target" in postgres|template0|template1) die "refusing to restore into system database $target" ;; esac

live_db="$(setting POSTGRES_DB ms_shelving)"
[ "$target" != "$live_db" ] || die "refusing to restore over the live database ($live_db); choose a new name"

compose ps --status running --services 2>/dev/null | grep -qx postgres \
  || die "the postgres service is not running"

if [ -f "$dump.sha256" ]; then
  log "checking sha256"
  expected="$(cut -d ' ' -f 1 <"$dump.sha256")"
  actual="$(sha256sum <"$dump" | cut -d ' ' -f 1)"
  [ "$expected" = "$actual" ] || die "checksum mismatch: $dump is corrupt or was modified"
else
  log "WARNING: no $dump.sha256 next to the backup; skipping checksum"
fi

psql_admin() {
  compose exec -T postgres sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres "$@"' psql "$@"
}
psql_target() {
  compose exec -T -e TARGET_DB="$target" postgres sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$TARGET_DB" "$@"' psql "$@"
}

exists="$(psql_admin -At -c "SELECT 1 FROM pg_database WHERE datname = '$target'")"
[ -z "$exists" ] || die "database $target already exists; refusing to overwrite it"

log "creating database $target"
compose exec -T -e TARGET_DB="$target" postgres sh -c 'exec createdb -U "$POSTGRES_USER" -T template0 "$TARGET_DB"'

log "restoring $dump into $target (single transaction, stop on first error)"
if ! compose exec -T -e TARGET_DB="$target" postgres sh -c \
  'exec pg_restore -U "$POSTGRES_USER" -d "$TARGET_DB" --no-owner --no-privileges --exit-on-error --single-transaction' <"$dump"; then
  die "pg_restore failed; $target was left EMPTY (drop it with: DROP DATABASE $target;)"
fi

log "verifying restored database"
failed_migrations="$(psql_target -At -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')"
applied_migrations="$(psql_target -At -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
[ "$failed_migrations" = "0" ] || die "restored database has $failed_migrations unfinished migration(s)"
[ "$applied_migrations" -gt 0 ] || die "restored database has no applied migrations"

log "applied migrations: $applied_migrations"
psql_target -c 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name'
# Row counts only — no customer data is printed.
psql_target <<'SQL'
SELECT 'User' AS "table", count(*) AS rows FROM "User"
UNION ALL SELECT 'ProductModel', count(*) FROM "ProductModel"
UNION ALL SELECT 'Component', count(*) FROM "Component"
UNION ALL SELECT 'Customer', count(*) FROM "Customer"
UNION ALL SELECT 'Order', count(*) FROM "Order"
UNION ALL SELECT 'OrderItem', count(*) FROM "OrderItem"
UNION ALL SELECT 'OrderDocument', count(*) FROM "OrderDocument"
UNION ALL SELECT 'PriceHistory', count(*) FROM "PriceHistory"
UNION ALL SELECT 'AuditLog', count(*) FROM "AuditLog";
SQL

log "restore OK into $target. It is NOT live. To promote it, follow docs/production-backups.md (Promote)."
