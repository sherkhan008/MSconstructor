import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { LOGIN_PATH_SESSION_ENDED } from '@/lib/auth/session';
import { buildMetadata } from '@/lib/seo';
import { AdminShell } from '@/components/admin/AdminShell';

export const metadata: Metadata = buildMetadata({
  title: 'Админ-панель',
  description: 'Внутренняя админ-панель MS Стеллажи.',
  path: '/admin',
  noIndex: true,
});

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  // src/middleware.ts already redirects an unauthenticated visitor away
  // from every /admin/* page — this is defense-in-depth, and the one place
  // that gives every page under this layout the verified session it needs
  // to render (admin name/role, role-gated controls).
  //
  // It is also where a REVOKED session is caught: the Edge middleware sees a
  // cookie that still verifies, so it has to be told not to send this visitor
  // straight back here (see LOGIN_PATH_SESSION_ENDED).
  const admin = await getCurrentAdmin();
  if (!admin) redirect(LOGIN_PATH_SESSION_ENDED);

  return <AdminShell admin={admin}>{children}</AdminShell>;
}
