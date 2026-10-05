#!/usr/bin/env bash
# ==============================================================================
# Proxy (nginx) operations. See docs/production-deployment.md, §8.
#
#   scripts/ops/proxy.sh check    internal readiness only (proxy → app → /api/health,
#                                 plus the TLS listener when PROXY_TLS_ENABLED=true)
#   scripts/ops/proxy.sh apply    apply the current PROXY_TLS_ENABLED and deploy/nginx
#                                 files: test them in a throwaway container first —
#                                 the running proxy is left untouched if that fails —
#                                 then recreate the proxy and verify readiness.
#                                 Used to enable TLS and to roll back to HTTP.
#   scripts/ops/proxy.sh reload   certificate renewal (certbot --deploy-hook):
#                                 `nginx -t` inside the running proxy, then a
#                                 graceful `nginx -s reload` — no restart, open
#                                 connections finish on the old certificate.
#                                 If the test fails, nginx is NOT reloaded and
#                                 keeps serving the previous certificate.
# ==============================================================================
OPS_NAME=proxy
# shellcheck source=scripts/ops/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

[ "$#" -eq 1 ] || die "usage: $0 check|apply|reload"
require_env_file
command -v docker >/dev/null || die "docker is not installed"

proxy_running() {
  compose ps --status running --services 2>/dev/null | grep -qx proxy
}

case "$1" in
  check)
    proxy_ready || die "proxy readiness failed (PROXY_TLS_ENABLED=$(proxy_tls_mode))"
    log "proxy ready (PROXY_TLS_ENABLED=$(proxy_tls_mode))"
    ;;
  apply)
    log "testing proxy configuration (PROXY_TLS_ENABLED=$(proxy_tls_mode))"
    proxy_preflight || die "proxy configuration is invalid (nginx output above); the running proxy was NOT changed"
    log "recreating proxy"
    compose up -d --no-deps --force-recreate proxy || die "proxy failed to start"
    if ! proxy_ready; then
      compose logs --no-color --tail 30 proxy >&2 || true
      die "proxy readiness failed after apply. Roll back: set PROXY_TLS_ENABLED=false in the env file and run: $0 apply"
    fi
    log "proxy applied and ready (PROXY_TLS_ENABLED=$(proxy_tls_mode))"
    ;;
  reload)
    if ! proxy_running; then
      log "proxy is not running; nothing to reload (it loads the current certificate when it starts)"
      exit 0
    fi
    compose exec -T proxy nginx -t \
      || die "nginx rejected the configuration or certificate; NOT reloaded — the proxy keeps serving the previous certificate"
    compose exec -T proxy nginx -s reload || die "nginx reload failed"
    proxy_ready || die "proxy readiness failed after reload"
    log "proxy reloaded"
    ;;
  *)
    die "usage: $0 check|apply|reload"
    ;;
esac
