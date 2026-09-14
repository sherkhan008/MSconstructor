import { NextResponse } from 'next/server';
import { hasDatabase, isProductionRuntime } from '@/lib/env';
import type { SchemaStatus } from '@/lib/db/migration-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness probe for Docker, scripts/ops/deploy.sh and external
 * monitors. Healthy means: the app answers, PostgreSQL answers, and every
 * migration bundled with this build is applied (src/lib/db/migration-status.ts)
 * — the app must not report ready against an older, incompatible schema.
 *
 * Redis deliberately does not affect this probe: public rate limits degrade
 * to per-instance memory and the storefront keeps working, while admin login
 * already fails closed on its own. Failing health would make Docker and the
 * deploy script treat a rate-limit-store outage as a dead storefront. Redis
 * has its own container healthcheck and logs `[rate-limit] Redis unavailable`.
 *
 * Never returns the connection string, a raw driver error or migration names.
 */
export async function GET() {
  const timestamp = new Date().toISOString();
  const noStore = { 'Cache-Control': 'no-store' };

  if (isProductionRuntime && !hasDatabase) {
    return NextResponse.json(
      { ok: false, status: 'unhealthy', database: 'not_configured', timestamp },
      { status: 503, headers: noStore },
    );
  }

  if (!hasDatabase) {
    return NextResponse.json({ ok: true, status: 'healthy', database: 'in-memory-sample-catalog', timestamp }, { headers: noStore });
  }

  let schema: SchemaStatus;
  try {
    const { prisma } = await import('@/lib/db/client');
    await prisma.$queryRaw`SELECT 1`;
    const { getSchemaStatus } = await import('@/lib/db/migration-status');
    schema = await getSchemaStatus(prisma);
  } catch {
    return NextResponse.json(
      { ok: false, status: 'unhealthy', database: 'postgres_unreachable', timestamp },
      { status: 503, headers: noStore },
    );
  }

  if (schema !== 'ok') {
    return NextResponse.json(
      { ok: false, status: 'unhealthy', database: 'postgres', schema, timestamp },
      { status: 503, headers: noStore },
    );
  }
  return NextResponse.json({ ok: true, status: 'healthy', database: 'postgres', schema, timestamp }, { headers: noStore });
}
