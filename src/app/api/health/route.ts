import { NextResponse } from 'next/server';
import { hasDatabase } from '@/lib/env';

export const runtime = 'nodejs';

/** Liveness/readiness probe for Docker and load balancers. */
export function GET() {
  return NextResponse.json({
    ok: true,
    status: 'healthy',
    database: hasDatabase ? 'postgres' : 'in-memory-sample-catalog',
    timestamp: new Date().toISOString(),
  });
}
