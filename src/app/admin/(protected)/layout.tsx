import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
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
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/admin/login');

  return <AdminShell admin={admin}>{children}</AdminShell>;
}
