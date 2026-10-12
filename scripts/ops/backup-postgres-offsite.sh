#!/usr/bin/env bash
# ==============================================================================
# Encrypted off-host wrapper for backup-postgres.sh. See docs/production-backups.md.
#
# Normal mode makes and locally verifies a PostgreSQL dump through the existing
# script, uploads only that dump and its SHA-256 sidecar to restic, verifies the
# repository, then applies the explicit 30-daily / 12-monthly retention policy.
# `--check` performs a full restic integrity check without making a new backup.
# Secrets are supplied at runtime by systemd's protected EnvironmentFile; this
# script never sources it, prints it, or embeds credentials in the repository.
# ==============================================================================
OPS_NAME=backup-offsite
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_env_file

mode="${1:-backup}"
[ "$#" -le 1 ] || die "usage: $0 [--check]"
case "$mode" in backup|--check) ;; *) die "usage: $0 [--check]" ;; esac

BACKUP_DIR="$(setting BACKUP_DIR /var/backups/ms-shelving)"
RESTIC_REPOSITORY="$(setting RESTIC_REPOSITORY '')"
RESTIC_PASSWORD_FILE="$(setting RESTIC_PASSWORD_FILE '')"
RESTIC_RETENTION_POLICY="$(setting RESTIC_RETENTION_POLICY '')"

[ -n "$RESTIC_REPOSITORY" ] || die "RESTIC_REPOSITORY is required"
[ -n "$RESTIC_PASSWORD_FILE" ] || die "RESTIC_PASSWORD_FILE is required from the protected runtime environment"
[ -f "$RESTIC_PASSWORD_FILE" ] && [ -r "$RESTIC_PASSWORD_FILE" ] || die "RESTIC_PASSWORD_FILE is not a readable regular file"
[ "$RESTIC_RETENTION_POLICY" = '30-daily-12-monthly' ] || die "RESTIC_RETENTION_POLICY must explicitly equal 30-daily-12-monthly"
case "$RESTIC_REPOSITORY" in *://*@*) die "RESTIC_REPOSITORY must not contain embedded credentials" ;; esac
command -v restic >/dev/null 2>&1 || die "restic is not installed or not on PATH"

export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE

if [ "$mode" = '--check' ]; then
  log "running full off-host repository integrity check"
  restic check
  log "off-host repository integrity check OK"
  exit 0
fi

# The local script retains its own read-back, checksum and local retention
# guarantees. Do not duplicate or replace it here.
bash "$(dirname "${BASH_SOURCE[0]}")/backup-postgres.sh"

latest_file="$BACKUP_DIR/LATEST"
[ -f "$latest_file" ] || die "local backup completed without BACKUP_DIR/LATEST"
name="$(tr -d '\r\n' <"$latest_file")"
[[ "$name" =~ ^ms_shelving_[0-9]{8}T[0-9]{6}Z\.dump$ ]] || die "LATEST is not a recognized PostgreSQL backup name"
[ -s "$BACKUP_DIR/$name" ] || die "latest dump is missing or empty"
[ -s "$BACKUP_DIR/$name.sha256" ] || die "latest dump checksum sidecar is missing or empty"

log "uploading verified local dump to encrypted off-host repository"
(
  cd "$BACKUP_DIR"
  restic backup --tag postgres --tag ms-shelving "$name" "$name.sha256"
)

# This checks repository metadata and a data sample. A separate monthly full
# check is installed below. The freshness marker is touched only after both
# remote upload and verification succeed.
log "verifying off-host repository after upload"
restic check --read-data-subset=5%
restic snapshots --tag postgres --latest 1 >/dev/null
touch "$BACKUP_DIR/OFFSITE_VERIFIED"

# Remote deletion is deliberate and is protected by the required named policy
# above. It cannot run until a new dump was successfully uploaded and checked.
log "applying off-host retention: 30 daily, 12 monthly"
restic forget --tag postgres --keep-daily 30 --keep-monthly 12 --prune
log "off-host backup OK: $name"
