import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from '@/components/admin/LogoutButton';
import type { AdminSessionPayload } from '@/lib/auth/session';

const ADMIN_ROLE_LABEL_RU: Record<string, string> = {
  SUPER_ADMIN: 'Главный администратор',
  ADMIN: 'Администратор',
  MANAGER: 'Менеджер',
  CONTENT_MANAGER: 'Контент-менеджер',
};

/** Minimal internal shell — one nav item today ("Заказы"), by design (spec:
 * keep scope small, no products/prices/customers/analytics sections yet). */
export function AdminShell({ admin, children }: { admin: AdminSessionPayload; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-background px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/admin/orders" className="font-display text-lg tracking-wide">
            MS Admin
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/admin/orders" className="tech-label hover:text-blueprint">
              Заказы
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-sm">
            <div>{admin.name}</div>
            <div className="tech-label text-steel">{ADMIN_ROLE_LABEL_RU[admin.role] ?? admin.role}</div>
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
