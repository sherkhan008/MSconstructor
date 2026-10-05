#!/bin/sh
# ==============================================================================
# Internal readiness probe, run INSIDE the proxy container:
#   docker compose --env-file .env.production exec -T proxy sh /etc/nginx/ms-shelving/readiness.sh
# Used by scripts/ops/deploy.sh and scripts/ops/proxy.sh (proxy_ready in
# scripts/ops/common.sh). Needs no DNS and never touches the public redirect.
#
# 1. nginx → app → /api/health through the loopback-only listener
#    (127.0.0.1:8081, common.conf). Fails on 502 (app unreachable) and on 503
#    (database down or schema not migrated).
# 2. PROXY_TLS_ENABLED=true only: the same request through the TLS listener,
#    with SNI and Host set to the APP_URL host, verifying the served
#    certificate chain and name against the system CA store. An expired,
#    missing or wrong certificate fails readiness.
# ==============================================================================
set -eu

wget -q -O /dev/null -T 5 http://127.0.0.1:8081/api/health

if [ "${PROXY_TLS_ENABLED:-false}" = "true" ]; then
  domain="$(printf '%s' "${APP_URL:-}" | tr '[:upper:]' '[:lower:]')"
  domain="${domain#https://}"
  domain="${domain%/}"
  curl -fsS -o /dev/null --max-time 5 --proto '=https' \
    --resolve "$domain:8443:127.0.0.1" "https://$domain:8443/api/health"
fi
