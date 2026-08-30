import { NextResponse } from 'next/server';
import { hasDatabase, isProductionRuntime } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Liveness/readiness probe for Docker and load balancers. Actually pings
 * PostgreSQL when one is configured — a configured-but-unreachable database
 * must fail this check, not report healthy from a boolean alone. Never
 * returns the connection string or a raw driver error.
 */
export async function GET() {
  const timestamp = new Date().toISOString();

  if (isProductionRuntime && !hasDatabase) {
    return NextResponse.json({ ok: false, status: 'unhealthy', database: 'not_configured', timestamp }, { status: 503 });
  }

  if (!hasDatabase) {
    return NextResponse.json({ ok: true, status: 'healthy', database: 'in-memory-sample-catalog', timestamp });
  }

  try {
    const { prisma } = await import('@/lib/db/client');
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, status: 'healthy', database: 'postgres', timestamp });
  } catch {
    return NextResponse.json({ ok: false, status: 'unhealthy', database: 'postgres_unreachable', timestamp }, { status: 503 });
  }
}
