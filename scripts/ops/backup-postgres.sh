#!/usr/bin/env bash
# ==============================================================================
# PostgreSQL backup for the production stack. See docs/production-backups.md.
#
#   scripts/ops/backup-postgres.sh
#
# - pg_dump runs INSIDE the postgres container over its local socket, so no
#   password is passed, typed or printed. pg_dump always matches the server version.
# - Custom format (-Fc): compressed, restorable table-by-table with pg_restore.
# - Written to <name>.partial, fully read back with pg_restore (catches a
#   truncated or corrupt archive), checked for the Prisma migration table,
#   checksummed, then atomically renamed. A failed run leaves no file that
#   looks like a good backup.
# - Retention runs only after a successful backup, only inside BACKUP_DIR,
#   only on files named ms_shelving_<UTC timestamp>.dump, and always keeps
#   the BACKUP_MIN_KEEP newest.
# - Any failure exits non-zero with a message on stderr (systemd marks the
#   unit failed; cron mails it). BACKUP_DIR/LATEST names the newest good backup.
#
# Settings (env or env file): BACKUP_DIR (/var/backups/ms-shelving),
# BACKUP_RETENTION_DAYS (14), BACKUP_MIN_KEEP (7).
# ==============================================================================
OPS_NAME=backup
# shellcheck source=scripts/ops/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_env_file

BACKUP_DIR="$(setting BACKUP_DIR /var/backups/ms-shelving)"
RETENTION_DAYS="$(setting BACKUP_RETENTION_DAYS 14)"
MIN_KEEP="$(setting BACKUP_MIN_KEEP 7)"
require_uint BACKUP_RETENTION_DAYS "$RETENTION_DAYS"
require_uint BACKUP_MIN_KEEP "$MIN_KEEP"
[ "$RETENTION_DAYS" -ge 1 ] || die "BACKUP_RETENTION_DAYS must be at least 1"
[ "$MIN_KEEP" -ge 1 ] || die "BACKUP_MIN_KEEP must be at least 1"
case "$BACKUP_DIR" in
  /?*) ;;
  [A-Za-z]:[\\/]*) ;; # Windows drive path (local rehearsal under Git Bash)
  *) die "BACKUP_DIR must be an absolute path" ;;
esac
[ "$BACKUP_DIR" != "/" ] || die "BACKUP_DIR must not be /"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_DIR/.backup.lock"
  flock -n 9 || die "another backup is already running"
fi

compose ps --status running --services 2>/dev/null | grep -qx postgres \
  || die "the postgres service is not running"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="ms_shelving_${stamp}.dump"
final="$BACKUP_DIR/$name"
partial="$final.partial"
cleanup() { rm -f -- "$partial"; }
trap cleanup EXIT

log "dumping database to $final"
# Single quotes: $POSTGRES_USER / $POSTGRES_DB expand inside the container.
if ! compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6' >"$partial"; then
  die "pg_dump failed; no backup written"
fi
[ -s "$partial" ] || die "pg_dump produced an empty file; no backup written"

log "verifying archive"
if ! compose exec -T postgres pg_restore --file=/dev/null <"$partial"; then
  die "archive failed pg_restore read-back; no backup written"
fi
if ! compose exec -T postgres pg_restore --list <"$partial" | grep -q 'TABLE public _prisma_migrations'; then
  die "archive has no _prisma_migrations table; refusing to keep it as a backup"
fi

( cd "$BACKUP_DIR" && sha256sum "$name.partial" | sed "s/\.partial\$//" >"$name.sha256" )
mv -f -- "$partial" "$final"
trap - EXIT
printf '%s\n' "$name" >"$BACKUP_DIR/LATEST"
size="$(wc -c <"$final" | tr -d ' ')"
log "backup OK: $name ($size bytes)"

# --- Retention -----------------------------------------------------------------
index=0
pruned=0
while IFS= read -r file; do
  index=$((index + 1))
  [ "$index" -le "$MIN_KEEP" ] && continue
  if [ -n "$(find "$BACKUP_DIR/$file" -maxdepth 0 -type f -mmin +"$((RETENTION_DAYS * 1440))" 2>/dev/null)" ]; then
    rm -f -- "${BACKUP_DIR:?}/$file" "${BACKUP_DIR:?}/$file.sha256"
    pruned=$((pruned + 1))
  fi
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ms_shelving_[0-9]*T[0-9]*Z.dump' -printf '%f\n' | sort -r)
log "retention: kept newest $MIN_KEEP unconditionally, pruned $pruned older than $RETENTION_DAYS days"
