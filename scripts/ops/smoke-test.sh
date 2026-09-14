#!/usr/bin/env bash
# ==============================================================================
# Post-deploy smoke test, run on the Docker host. Read-only by default.
#
#   scripts/ops/smoke-test.sh [--check-ip-contract]
#
#   BASE_URL            public entry point (default http://127.0.0.1:<PUBLIC_HTTP_BIND port>)
#   SMOKE_ADMIN_EMAIL   optional: also verify admin login (records one audit-log row)
#   SMOKE_ADMIN_PASSWORD
#   --check-ip-contract sends 6 invalid order POSTs with forged forwarding
#                       headers; the 6th must be rate limited (429), proving
#                       forged headers do not create new rate-limit identities.
#                       Uses up this host's order limit for 60 s. Creates no data.
# ==============================================================================
OPS_NAME=smoke
# shellcheck source=scripts/ops/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

CHECK_IP=0
for arg in "$@"; do
  case "$arg" in
    --check-ip-contract) CHECK_IP=1 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

require_env_file
command -v curl >/dev/null || die "curl is required"

bind="$(setting PUBLIC_HTTP_BIND 80)"
BASE_URL="${BASE_URL:-http://127.0.0.1:${bind##*:}}"
failures=0
pass() { log "PASS $*"; }
fail() { log "FAIL $*"; failures=$((failures + 1)); }

# --- 1. Network exposure --------------------------------------------------------
for service in app postgres redis; do
  id="$(compose ps -q "$service" 2>/dev/null || true)"
  if [ -z "$id" ]; then fail "$service container is not running"; continue; fi
  published="$(docker inspect -f '{{range $port, $bindings := .NetworkSettings.Ports}}{{if $bindings}}{{$port}} {{end}}{{end}}' "$id")"
  if [ -z "${published// /}" ]; then pass "$service publishes no host port"; else fail "$service publishes host port(s): $published"; fi
done
proxy_id="$(compose ps -q proxy 2>/dev/null || true)"
if [ -n "$proxy_id" ]; then
  pass "proxy publishes: $(docker inspect -f '{{range $port, $bindings := .NetworkSettings.Ports}}{{range $bindings}}{{.HostIp}}:{{.HostPort}}->{{$port}} {{end}}{{end}}' "$proxy_id")"
else
  fail "proxy container is not running"
fi
for service in postgres redis; do
  id="$(compose ps -q "$service" 2>/dev/null || true)"
  [ -n "$id" ] || continue
  networks="$(docker inspect -f '{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{end}}' "$id")"
  case "$networks" in
    *_backend\ ) pass "$service is attached only to the internal backend network" ;;
    *) fail "$service networks: $networks (expected only <project>_backend)" ;;
  esac
done

# --- 2. Public pages and health through the proxy -------------------------------
health="$(curl -fsS --max-time 10 "$BASE_URL/api/health" || true)"
case "$health" in
  *'"ok":true'*'"schema":"ok"'*) pass "/api/health healthy, schema ok" ;;
  *) fail "/api/health not healthy: ${health:-no response}" ;;
esac
case "$health" in
  *postgres://*|*postgresql://*|*redis://*|*password*) fail "/api/health leaks connection details" ;;
esac

for path in / /catalog /catalog/ms-standard /configurator /robots.txt; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$BASE_URL$path" || echo 000)"
  if [ "$code" = "200" ]; then pass "GET $path -> 200"; else fail "GET $path -> $code"; fi
done

code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL/admin/orders" || echo 000)"
if [ "$code" = "307" ] || [ "$code" = "302" ]; then pass "GET /admin/orders without session redirects ($code)"; else fail "GET /admin/orders without session -> $code"; fi

server_header="$(curl -sS -D - -o /dev/null --max-time 10 "$BASE_URL/api/health" | tr -d '\r' | grep -i '^server:' || true)"
case "$server_header" in
  *[0-9].[0-9]*) fail "Server header discloses a version: $server_header" ;;
  *) pass "Server header discloses no version" ;;
esac

# --- 3. Admin login (optional) --------------------------------------------------
if [ -n "${SMOKE_ADMIN_EMAIL:-}" ] && [ -n "${SMOKE_ADMIN_PASSWORD:-}" ]; then
  jar="$(mktemp)"
  # JSON-encode with the app container's node (the host may have no node);
  # the credentials travel as environment variables, never as arguments.
  export SMOKE_ADMIN_EMAIL SMOKE_ADMIN_PASSWORD
  body="$(compose exec -T -e SMOKE_ADMIN_EMAIL -e SMOKE_ADMIN_PASSWORD app \
    node -e 'process.stdout.write(JSON.stringify({email:process.env.SMOKE_ADMIN_EMAIL,password:process.env.SMOKE_ADMIN_PASSWORD}))')"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -c "$jar" -H 'Content-Type: application/json' --data-binary @- \
    --max-time 15 "$BASE_URL/api/admin/login" <<<"$body" || echo 000)"
  if [ "$code" = "200" ]; then pass "admin login -> 200"; else fail "admin login -> $code"; fi
  code="$(curl -sS -o /dev/null -w '%{http_code}' -b "$jar" --max-time 20 "$BASE_URL/admin/orders" || echo 000)"
  if [ "$code" = "200" ]; then pass "GET /admin/orders with session -> 200"; else fail "GET /admin/orders with session -> $code"; fi
  rm -f "$jar"
else
  log "SKIP admin login (set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD)"
fi

# --- 4. Trusted client-IP contract (optional) ------------------------------------
if [ "$CHECK_IP" -eq 1 ]; then
  last=""
  for i in 1 2 3 4 5 6; do
    last="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST \
      -H 'Content-Type: application/json' \
      -H "X-Real-IP: 203.0.113.$i" -H "X-Forwarded-For: 198.51.100.$i" -H "CF-Connecting-IP: 192.0.2.$i" \
      --data '{}' "$BASE_URL/api/orders" || echo 000)"
  done
  if [ "$last" = "429" ]; then
    pass "forged forwarding headers do not create new rate-limit identities (6th request -> 429)"
  else
    fail "6th order POST with forged headers -> $last (expected 429)"
  fi
fi

if [ "$failures" -gt 0 ]; then die "$failures smoke check(s) failed"; fi
log "all smoke checks passed"
