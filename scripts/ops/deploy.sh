#!/usr/bin/env bash
# ==============================================================================
# Build and deploy the current checkout. See docs/production-deployment.md.
#
#   scripts/ops/deploy.sh                 normal deploy (backup first)
#   scripts/ops/deploy.sh --first-deploy  empty server: no database to back up yet
#
# Order, each step stopping the deploy on failure:
#   1. validate the Compose configuration (every required secret present)
#   2. back up PostgreSQL                         (skipped only with --first-deploy)
#   3. build the app + migrate images, tagged with the git commit
#   4. start postgres + redis and wait until healthy
#   5. prisma migrate deploy (one-shot container) — failure: app NOT restarted
#   6. recreate the app on the new image and wait for its healthcheck
#      (/api/health: PostgreSQL reachable + schema matches this build)
#   7. ensure the proxy runs; verify /api/health through it
#
# Migrations must be backward compatible with the previous app version,
# which keeps serving until step 6 (expand → deploy → contract).
# ==============================================================================
OPS_NAME=deploy
# shellcheck source=scripts/ops/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

FIRST_DEPLOY=0
for arg in "$@"; do
  case "$arg" in
    --first-deploy) FIRST_DEPLOY=1 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

require_env_file
command -v docker >/dev/null || die "docker is not installed"

log "validating compose configuration"
compose config --quiet || die "compose configuration is invalid (see messages above)"

if [ -z "${APP_IMAGE_TAG:-}" ]; then
  APP_IMAGE_TAG="$(git -C "$OPS_ROOT" rev-parse --short=12 HEAD 2>/dev/null || true)"
  [ -n "$APP_IMAGE_TAG" ] || die "cannot derive APP_IMAGE_TAG from git; set it explicitly"
  if [ -n "$(git -C "$OPS_ROOT" status --porcelain 2>/dev/null)" ]; then
    APP_IMAGE_TAG="${APP_IMAGE_TAG}-dirty"
    log "WARNING: working tree has uncommitted changes; tagging image $APP_IMAGE_TAG"
  fi
fi
[[ "$APP_IMAGE_TAG" =~ ^[A-Za-z0-9_.-]{1,128}$ ]] || die "invalid APP_IMAGE_TAG"
export APP_IMAGE_TAG
log "release tag: $APP_IMAGE_TAG"

if [ "$FIRST_DEPLOY" -eq 1 ]; then
  log "first deploy: skipping pre-deploy backup"
else
  compose ps --status running --services 2>/dev/null | grep -qx postgres \
    || die "postgres is not running, so no pre-deploy backup can be taken. Start it (compose up -d postgres) or use --first-deploy on an empty server."
  bash "$OPS_ROOT/scripts/ops/backup-postgres.sh" || die "pre-deploy backup failed; nothing was changed"
fi

log "building images"
compose build app migrate || die "image build failed; nothing was changed"

log "starting postgres and redis"
compose up -d --wait --wait-timeout 120 postgres redis || die "postgres/redis did not become healthy"

log "applying migrations (prisma migrate deploy)"
if ! compose run --rm --no-deps migrate; then
  die "migration FAILED. The app was NOT restarted; the previous version keeps serving. Read the migration output above, fix forward, and see docs/production-deployment.md (Failed migration)."
fi

log "starting app $APP_IMAGE_TAG"
if ! compose up -d --no-deps --wait --wait-timeout 180 app; then
  compose logs --no-color --tail 50 app >&2 || true
  die "app did not become healthy. Roll back with: scripts/ops/rollback-app.sh <previous tag> (see .deploy/history)"
fi

log "ensuring proxy is running"
compose up -d --no-deps proxy || die "proxy failed to start"

# Same image as `migrate` (built above); retries failed notification deliveries.
log "starting notifications worker $APP_IMAGE_TAG"
compose up -d --no-deps --no-build notifications-worker || die "notifications worker failed to start"

log "verifying /api/health through the proxy"
ok=0
for _ in $(seq 1 15); do
  if compose exec -T proxy wget -q -O /dev/null http://127.0.0.1:8080/api/health; then ok=1; break; fi
  sleep 2
done
[ "$ok" -eq 1 ] || die "/api/health is not OK through the proxy"

# The deployed image also becomes :latest, so a manual `docker compose up -d`
# (no APP_IMAGE_TAG) keeps running this release instead of rebuilding.
docker tag "ms-shelving-app:$APP_IMAGE_TAG" ms-shelving-app:latest
docker tag "ms-shelving-migrate:$APP_IMAGE_TAG" ms-shelving-migrate:latest

mkdir -p "$OPS_ROOT/.deploy"
printf '%s deploy %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$APP_IMAGE_TAG" >>"$OPS_ROOT/.deploy/history"
log "deploy OK: $APP_IMAGE_TAG. Run the smoke test: scripts/ops/smoke-test.sh"
