#!/usr/bin/env bash
# Fails when no locally recorded *verified off-host* PostgreSQL backup is
# newer than 26 hours. This is intentionally separate from the backup job so
# a timer, alerting service, or external monitor can detect a stale success.
OPS_NAME=backup-age
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_env_file
BACKUP_DIR="$(setting BACKUP_DIR /var/backups/ms-shelving)"
marker="$BACKUP_DIR/OFFSITE_VERIFIED"
[ -f "$marker" ] || die "no verified off-host backup marker exists"
find "$marker" -maxdepth 0 -type f -mmin -1560 | grep -q . \
  || die "no verified off-host PostgreSQL backup is newer than 26 hours"
log "verified off-host PostgreSQL backup is newer than 26 hours"
