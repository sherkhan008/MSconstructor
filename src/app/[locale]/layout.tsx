import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import '../globals.css';
import { fontVariables } from '../fonts';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { WhatsAppFloatingButton } from '@/components/layout/WhatsAppFloatingButton';
import { AnalyticsScripts } from '@/components/layout/AnalyticsScripts';
import { LocaleProvider } from '@/components/i18n/LocaleProvider';
import { appUrl } from '@/lib/env';
import { site, siteCopy } from '@/lib/config/site';
import { HTML_LANG, LOCALES, OG_LOCALE, isLocale, type Locale } from '@/lib/i18n/locales';
import { t } from '@/lib/i18n/format';
import { SE } from '@/lib/i18n/strings';
import { organizationJsonLd, jsonLdScriptProps } from '@/lib/seo';

/**
 * Root layout of the public site, one per locale. Kazakh pages are served at
 * the unprefixed root and reach this segment as `kk` through the middleware
 * rewrite (src/middleware.ts); Russian pages are the real `/ru/...` URLs. Any
 * other value is not a locale of this site.
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const dynamicParams = false;

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'kk';
  const copy = siteCopy(locale);
  const brand = { brand: copy.name };

  return {
    metadataBase: new URL(appUrl),
    title: {
      default: t(SE['SE-001'], locale, brand),
      template: `%s | ${copy.name}`,
    },
    description: copy.shortDescription,
    keywords: [SE['SE-003'], SE['SE-004'], SE['SE-005'], SE['SE-006'], SE['SE-007'], SE['SE-008'], SE['SE-009']].map((entry) =>
      t(entry, locale),
    ),
    authors: [{ name: site.legalName }],
    openGraph: {
      type: 'website',
      locale: OG_LOCALE[locale],
      siteName: copy.name,
      title: t(SE['SE-002'], locale, brand),
      description: copy.shortDescription,
    },
    twitter: {
      card: 'summary_large_image',
      title: t(SE['SE-002'], locale, brand),
      description: copy.shortDescription,
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1C2024',
};

export default async function PublicRootLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html lang={HTML_LANG[locale]} className={fontVariables}>
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <script {...jsonLdScriptProps(organizationJsonLd(locale))} type="application/ld+json" />
        <LocaleProvider locale={locale}>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer locale={locale} />
          <WhatsAppFloatingButton />
        </LocaleProvider>
        <AnalyticsScripts />
      </body>
    </html>
  );
}
