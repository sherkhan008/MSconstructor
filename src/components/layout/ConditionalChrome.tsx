'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { WhatsAppFloatingButton } from '@/components/layout/WhatsAppFloatingButton';

/**
 * /admin is its own internal area with its own shell
 * (src/components/admin/AdminShell.tsx) — it must not render the public
 * storefront's Header/Footer/WhatsApp button. This decision has to be a
 * client component using usePathname(): the root layout wraps every route,
 * including previously-statically-generated public pages, and reading the
 * pathname via a server-side API there (next/headers `headers()`) would
 * force every one of those pages out of static generation. usePathname()
 * carries no such cost.
 */
export function ConditionalChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin') ?? false;

  return (
    <>
      {!isAdmin && <Header />}
      <main className="flex-1">{children}</main>
      {!isAdmin && <Footer />}
      {!isAdmin && <WhatsAppFloatingButton />}
    </>
  );
}
