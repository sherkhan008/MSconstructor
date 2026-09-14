# syntax=docker/dockerfile:1

# ==============================================================================
# MS Shelving — production images.
# Multi-stage build: deps -> builder -> runner, using Next.js `output: standalone`
# (next.config.ts) so the final image only ships the files actually needed at
# runtime, not the full node_modules tree.
#
# Targets:
#   runner   (default, last stage) — the web application: `node server.js`.
#   migrator — one-shot tool image: `prisma migrate deploy`, plus the seed and
#              catalog maintenance scripts. Never serves traffic. Used by the
#              `migrate` service in docker-compose.yml.
# ==============================================================================

# Node 20 line, >= 20.19.0 — the floor package.json "engines" declares (the
# lint toolchain's @typescript-eslint needs it; pdfjs-dist 4.10.38, used by the
# PDF tests, needs >= 20). The floating node:20 tag resolves to the latest 20.x.
FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

# --- Dependencies -------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# --- Build ---------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# No DATABASE_URL here, on purpose: `next build` needs no database. Every
# route that reads the catalog renders at request time, and getCatalog()
# throws during the build (src/lib/data/repository.ts) so a route that tries
# to prerender database data fails here instead of baking it into the image.
# The runtime container gets the real DATABASE_URL via docker-compose / the
# platform's env configuration, where production still requires it.
#
# NEXT_PUBLIC_* values are inlined into the JavaScript bundles by `next build`
# — setting them only at runtime has no effect on the browser. They are
# public by definition (never pass a secret as a build argument: build args
# are visible in the image history). An unset NEXT_PUBLIC_WHATSAPP_NUMBER
# builds with the placeholder number and the server logs a startup warning.
# NEXT_PUBLIC_APP_URL is intentionally not a build argument: the server
# falls back to the runtime APP_URL, so one image works for any domain.
ARG NEXT_PUBLIC_WHATSAPP_NUMBER
ARG NEXT_PUBLIC_GOOGLE_ANALYTICS_ID
ARG NEXT_PUBLIC_YANDEX_METRICA_ID
ENV NEXT_TELEMETRY_DISABLED=1
# next/font/google downloads Inter, Oswald and IBM Plex Mono here (build
# needs outbound HTTPS to fonts.googleapis.com / fonts.gstatic.com). The font
# files are then self-hosted from /_next/static/media — the running
# application makes no request to Google. See docs/production-deployment.md.
#
# An empty build argument is unset rather than inlined as "": src/lib/env.ts
# rejects empty values, and one empty NEXT_PUBLIC_* would invalidate the rest.
RUN set -e; \
    [ -n "$NEXT_PUBLIC_WHATSAPP_NUMBER" ] || unset NEXT_PUBLIC_WHATSAPP_NUMBER; \
    [ -n "$NEXT_PUBLIC_GOOGLE_ANALYTICS_ID" ] || unset NEXT_PUBLIC_GOOGLE_ANALYTICS_ID; \
    [ -n "$NEXT_PUBLIC_YANDEX_METRICA_ID" ] || unset NEXT_PUBLIC_YANDEX_METRICA_ID; \
    npm run build

# --- Migrations / operational scripts -------------------------------------------
FROM base AS migrator
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
RUN npx prisma generate && chown -R node:node /app/node_modules/.prisma
USER node
# Applies committed migrations only. Never `db push`, never `migrate reset`.
# Exits non-zero on any failure, which stops `docker compose up` (the app
# service depends on this one completing successfully).
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# --- Runtime ---------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# prisma/migrations is also read at runtime by /api/health to confirm the
# database schema matches this build (src/lib/db/migration-status.ts).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
