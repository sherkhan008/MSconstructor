#!/usr/bin/env bash
# Generic OnFailure hook. BACKUP_ALERT_COMMAND is an absolute executable path
# injected at runtime (for example, a protected local webhook/email wrapper).
# It receives one safe unit/event name as its sole argument; no command string
# is evaluated and no secret is logged.
OPS_NAME=backup-alert
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

event="${1:-backup-failure}"
[[ "$event" =~ ^[A-Za-z0-9_.@:-]{1,160}$ ]] || die "unsafe alert event name"
command_path="${BACKUP_ALERT_COMMAND:-}"
if [ -z "$command_path" ]; then
  log "BACKUP_ALERT_COMMAND is not configured; failure remains visible in systemd/journal"
  exit 0
fi
case "$command_path" in /*) ;; *) die "BACKUP_ALERT_COMMAND must be an absolute executable path" ;; esac
[ -x "$command_path" ] || die "BACKUP_ALERT_COMMAND is not executable"
"$command_path" "$event"
