import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth/current-admin';
import { buildMetadata } from '@/lib/seo';
import { Container } from '@/components/ui/Container';
import { LoginForm } from '@/components/admin/LoginForm';

export const metadata: Metadata = buildMetadata({
  title: 'Вход в админ-панель',
  description: 'Внутренняя админ-панель MS Стеллажи.',
  path: '/admin/login',
  noIndex: true,
});

export default async function AdminLoginPage() {
  // src/middleware.ts already redirects an authenticated visitor away from
  // this page — this is defense-in-depth in case that check is ever
  // bypassed or the matcher misconfigured.
  const admin = await getCurrentAdmin();
  if (admin) redirect('/admin/orders');

  return (
    <Container className="flex min-h-screen flex-col items-center justify-center gap-8 py-16">
      <div className="text-center">
        <h1 className="font-display text-3xl">MS Admin</h1>
        <p className="mt-1 text-sm text-steel">Вход для сотрудников</p>
      </div>
      <LoginForm />
    </Container>
  );
}
