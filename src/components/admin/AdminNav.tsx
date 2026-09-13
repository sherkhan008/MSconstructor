'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { canManagePrices } from '@/lib/auth/authorize';
import type { AdminRole } from '@/lib/types/domain';

/**
 * Admin sections the signed-in role may open.
 *
 * The "Цены" entry is hidden from MANAGER/CONTENT_MANAGER through the same
 * canManagePrices() predicate the API and the page itself use — hiding a link
 * is a usability decision, never the security control: /api/admin/prices/*
 * re-checks the role server-side on every request.
 */
const SECTIONS: { href: string; label: string; visible: (role: AdminRole) => boolean }[] = [
  { href: '/admin/orders', label: 'Заказы', visible: () => true },
  { href: '/admin/prices', label: 'Цены', visible: canManagePrices },
];

export function AdminNav({ role }: { role: AdminRole }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-4">
      {SECTIONS.filter((section) => section.visible(role)).map((section) => {
        const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={`tech-label border-b-2 py-1 hover:text-blueprint ${
              active ? 'border-blueprint text-blueprint' : 'border-transparent'
            }`}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
