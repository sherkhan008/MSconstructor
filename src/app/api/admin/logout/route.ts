import { cookies } from 'next/headers';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { recordAuditLog, requestMeta } from '@/lib/admin/audit';
import { apiOk } from '@/lib/api/response';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * Clears the session cookie regardless of whether it was still valid, and
 * regardless of whether the audit-log write succeeds — logging out must
 * never get stuck because the database is briefly unreachable.
 */
export async function POST(request: NextRequest) {
  const admin = await getCurrentAdmin();
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);

  if (admin) {
    void recordAuditLog({
      userId: admin.sub,
      action: 'ADMIN_LOGOUT',
      entityType: 'USER',
      entityId: admin.sub,
      ...requestMeta(request.headers),
    }).catch(() => {});
  }

  return apiOk({});
}
