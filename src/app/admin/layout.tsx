import type { Metadata, Viewport } from 'next';
import '../globals.css';
import { fontVariables } from '../fonts';
import { appUrl } from '@/lib/env';
import { site } from '@/lib/config/site';
import { AnalyticsScripts } from '@/components/layout/AnalyticsScripts';

/**
 * Root layout of the internal admin panel. The admin is Russian-only and is
 * not part of the public locale tree (src/app/[locale]): it has its own
 * `<html lang="ru">`, no public Header/Footer/WhatsApp button, and is never
 * served under /ru.
 */
export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: site.name, template: `%s | ${site.name}` },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1C2024',
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={fontVariables}>
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <main className="flex-1">{children}</main>
        <AnalyticsScripts />
      </body>
    </html>
  );
}
