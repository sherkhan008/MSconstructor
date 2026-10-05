#!/bin/sh
# ==============================================================================
# MS Shelving proxy entrypoint (docker-compose.yml, service `proxy`).
#
# Renders /etc/nginx/conf.d/default.conf from the tracked files in this
# directory, chosen by PROXY_TLS_ENABLED from .env.production, then hands over
# to the stock nginx entrypoint. Switching modes is an env-file change plus a
# proxy restart — no tracked file is ever edited on the server.
#
#   PROXY_TLS_ENABLED=false  http.conf            (HTTP bootstrap, before a certificate exists)
#   PROXY_TLS_ENABLED=true   https.conf.template  (domain = host of APP_URL)
#
# Fails closed: an unknown mode, an APP_URL that is not https://<host>, or a
# missing certificate stops the container with a clear message instead of
# starting nginx with a half-working configuration.
# ==============================================================================
set -eu

src=/etc/nginx/ms-shelving
out=/etc/nginx/conf.d/default.conf

fail() {
  echo "ms-shelving proxy: ERROR: $*" >&2
  exit 1
}

case "${PROXY_TLS_ENABLED:-false}" in
  false)
    cp "$src/http.conf" "$out"
    echo "ms-shelving proxy: PROXY_TLS_ENABLED=false — plain HTTP bootstrap mode" >&2
    ;;
  true)
    domain="$(printf '%s' "${APP_URL:-}" | tr '[:upper:]' '[:lower:]')"
    domain="${domain#https://}"
    domain="${domain%/}"
    printf '%s\n' "$domain" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' \
      || fail "PROXY_TLS_ENABLED=true requires APP_URL=https://<domain> (no port, path or placeholder)"
    for file in fullchain.pem privkey.pem; do
      [ -r "/etc/letsencrypt/live/$domain/$file" ] \
        || fail "/etc/letsencrypt/live/$domain/$file not found — issue the certificate first (docs/production-deployment.md, §8)"
    done
    # Substitute ONLY ${TLS_DOMAIN}; nginx's own $variables stay untouched.
    # shellcheck disable=SC2016
    TLS_DOMAIN="$domain" envsubst '${TLS_DOMAIN}' <"$src/https.conf.template" >"$out"
    echo "ms-shelving proxy: PROXY_TLS_ENABLED=true — HTTPS for $domain, HTTP redirects to HTTPS" >&2
    ;;
  *)
    fail "PROXY_TLS_ENABLED must be exactly true or false"
    ;;
esac

exec /docker-entrypoint.sh "$@"
