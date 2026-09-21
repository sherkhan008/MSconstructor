#!/usr/bin/env bash
# ==============================================================================
# APPLICATION-ONLY rollback to a previously deployed image tag.
#
#   scripts/ops/rollback-app.sh <tag>      (tags: .deploy/history, docker images ms-shelving-app)
#
# Does not touch the database: migrations are never rolled back
# automatically. The older app runs against the newer schema, which is safe
# as long as migrations follow expand → contract. /api/health accepts extra
# migrations the older image does not know. If the schema change was NOT
# backward compatible, see docs/production-deployment.md (Rollback).
# ==============================================================================
OPS_NAME=rollback
# shellcheck source=scripts/ops/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

[ "$#" -eq 1 ] || die "usage: $0 <tag>"
APP_IMAGE_TAG="$1"
[[ "$APP_IMAGE_TAG" =~ ^[A-Za-z0-9_.-]{1,128}$ ]] || die "invalid tag"
export APP_IMAGE_TAG

require_env_file
docker image inspect "ms-shelving-app:$APP_IMAGE_TAG" >/dev/null 2>&1 \
  || die "image ms-shelving-app:$APP_IMAGE_TAG not found on this host"

log "rolling the app back to $APP_IMAGE_TAG (database unchanged)"
# --no-deps: do not run the (older) migrate image; --no-build: never rebuild.
if ! compose up -d --no-deps --no-build --wait --wait-timeout 180 app; then
  compose logs --no-color --tail 50 app >&2 || true
  die "app $APP_IMAGE_TAG did not become healthy"
fi
compose up -d --no-deps proxy || die "proxy failed to start"

docker tag "ms-shelving-app:$APP_IMAGE_TAG" ms-shelving-app:latest
if docker image inspect "ms-shelving-migrate:$APP_IMAGE_TAG" >/dev/null 2>&1; then
  docker tag "ms-shelving-migrate:$APP_IMAGE_TAG" ms-shelving-migrate:latest
  # The notifications worker runs from the migrate image; keep it on the same
  # release as the app. (An older image predating the worker simply lacks it.)
  if docker run --rm --entrypoint test "ms-shelving-migrate:$APP_IMAGE_TAG" -f scripts/notification-retry-worker.ts; then
    compose up -d --no-deps --no-build notifications-worker || die "notifications worker failed to start"
  else
    compose stop notifications-worker >/dev/null 2>&1 || true
    log "WARNING: $APP_IMAGE_TAG has no notifications worker; failed notifications are not retried until the next deploy"
  fi
fi
mkdir -p "$OPS_ROOT/.deploy"
printf '%s rollback %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$APP_IMAGE_TAG" >>"$OPS_ROOT/.deploy/history"
log "rollback OK: app is running $APP_IMAGE_TAG"
