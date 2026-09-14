# shellcheck shell=bash
# ==============================================================================
# Shared helpers for scripts/ops/*.sh. Sourced, not executed.
#
# Inputs (environment):
#   ENV_FILE             production env file (default: <repo>/.env.production)
#   COMPOSE_FILE         compose file         (default: <repo>/docker-compose.yml)
#   COMPOSE_PROJECT_NAME optional; Compose's standard override of the project name
#
# Secrets policy: these scripts never `source` the env file (it is data, not
# shell code), never enable `set -x`, and never print variable values. Only
# the non-secret operational settings below are read from the file.
# ==============================================================================
set -euo pipefail
umask 077

OPS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$OPS_ROOT/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$OPS_ROOT/docker-compose.yml}"

log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${OPS_NAME:-ops}" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

require_env_file() {
  [ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE (copy .env.production.example)"
}

compose() {
  docker compose --project-directory "$OPS_ROOT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# setting NAME DEFAULT — a NON-SECRET operational setting: the process
# environment wins, then the last `NAME=value` line of the env file, then DEFAULT.
setting() {
  local name="$1" default="$2" line value
  if [ -n "${!name:-}" ]; then printf '%s' "${!name}"; return; fi
  line="$(grep -E "^[[:space:]]*${name}=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)"
  value="${line#*=}"
  value="${value%%[[:space:]]#*}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  if [ -n "$value" ]; then printf '%s' "$value"; else printf '%s' "$default"; fi
}

require_uint() {
  [[ "$2" =~ ^[0-9]+$ ]] || die "$1 must be a non-negative integer"
}
