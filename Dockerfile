# syntax=docker/dockerfile:1

# ==============================================================================
# MS Shelving — production image.
# Multi-stage build: deps -> builder -> runner, using Next.js `output: standalone`
# (next.config.ts) so the final image only ships the files actually needed at
# runtime, not the full node_modules tree.
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
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Runtime ---------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
