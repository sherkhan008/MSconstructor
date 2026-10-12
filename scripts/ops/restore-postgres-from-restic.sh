#!/usr/bin/env bash
# ==============================================================================
# Restore one restic snapshot into a NEW PostgreSQL database. See the runbook.
#
# Usage: restore-postgres-from-restic.sh <snapshot-id|latest> <backup-name.dump> <new_database_name>
# The selected repository is checked before restoration; the recovered dump is
# SHA-256 verified by restore-postgres.sh, which refuses the live DB name and
# any existing target. It never promotes or overwrites application data.
# ==============================================================================
OPS_NAME=restore-offsite
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

[ "$#" -eq 3 ] || die "usage: $0 <snapshot-id|latest> <backup-name.dump> <new_database_name>"
snapshot="$1"
name="$2"
target="$3"
[[ "$snapshot" =~ ^([a-f0-9]{4,64}|latest)$ ]] || die "snapshot must be a restic ID prefix or latest"
[[ "$name" =~ ^ms_shelving_[0-9]{8}T[0-9]{6}Z\.dump$ ]] || die "backup name is not recognized"

require_env_file
BACKUP_DIR="$(setting BACKUP_DIR /var/backups/ms-shelving)"
RESTIC_REPOSITORY="$(setting RESTIC_REPOSITORY '')"
RESTIC_PASSWORD_FILE="$(setting RESTIC_PASSWORD_FILE '')"
[ -n "$RESTIC_REPOSITORY" ] || die "RESTIC_REPOSITORY is required"
[ -n "$RESTIC_PASSWORD_FILE" ] || die "RESTIC_PASSWORD_FILE is required from the protected runtime environment"
[ -f "$RESTIC_PASSWORD_FILE" ] && [ -r "$RESTIC_PASSWORD_FILE" ] || die "RESTIC_PASSWORD_FILE is not a readable regular file"
case "$RESTIC_REPOSITORY" in *://*@*) die "RESTIC_REPOSITORY must not contain embedded credentials" ;; esac
command -v restic >/dev/null 2>&1 || die "restic is not installed or not on PATH"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE

mkdir -p "$BACKUP_DIR"
temp_dir="$(mktemp -d "$BACKUP_DIR/.restic-restore.XXXXXX")"
cleanup() { rm -f -- "$temp_dir/$name" "$temp_dir/$name.sha256"; rmdir "$temp_dir" 2>/dev/null || true; }
trap cleanup EXIT

log "checking selected off-host repository before restore"
restic check
log "recovering selected dump and checksum sidecar"
restic restore "$snapshot" --target "$temp_dir" --include "$name" --include "$name.sha256"
[ -s "$temp_dir/$name" ] || die "selected snapshot does not contain the requested dump"
[ -s "$temp_dir/$name.sha256" ] || die "selected snapshot does not contain the requested checksum sidecar"

# This performs the SHA-256 check, creates only a new DB, restores in a
# transaction and verifies the Prisma migration state.
bash "$(dirname "${BASH_SOURCE[0]}")/restore-postgres.sh" "$temp_dir/$name" "$target"
log "off-host restore rehearsal OK; $target is not live"
