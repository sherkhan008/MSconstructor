# syntax=docker/dockerfile:1

# ==============================================================================
# MS Shelving — production image.
# Multi-stage build: deps -> builder -> runner, using Next.js `output: standalone`
# (next.config.ts) so the final image only ships the files actually needed at
# runtime, not the full node_modules tree.
# ==============================================================================

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
# A placeholder DATABASE_URL lets `next build` complete even though no real
# database is reachable at build time; the runtime container gets the real
# value injected via docker-compose / the platform's env configuration.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/ms_shelving"
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
