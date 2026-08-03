import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Inter, Oswald } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { WhatsAppFloatingButton } from '@/components/layout/WhatsAppFloatingButton';
import { appUrl, publicEnv } from '@/lib/env';
import { site } from '@/lib/config/site';
import { organizationJsonLd, jsonLdScriptProps } from '@/lib/seo';

const oswald = Oswald({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  variable: '--font-oswald',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  variable: '--font-inter',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: `${site.name} — модульные металлические стеллажи | Казахстан`,
    template: `%s | ${site.name}`,
  },
  description: site.shortDescription,
  keywords: [
    'стеллаж металлический',
    'купить стеллаж',
    'складской стеллаж',
    'архивный стеллаж',
    'стеллаж Казахстан',
    'MS стеллажи',
    'конфигуратор стеллажей',
  ],
  authors: [{ name: site.legalName }],
  alternates: {
    canonical: appUrl,
    languages: { ru: appUrl, kk: appUrl },
  },
  openGraph: {
    type: 'website',
    locale: 'ru_KZ',
    siteName: site.name,
    title: `${site.name} — модульные металлические стеллажи`,
    description: site.shortDescription,
    url: appUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${site.name} — модульные металлические стеллажи`,
    description: site.shortDescription,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1C2024',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${oswald.variable} ${inter.variable} ${plexMono.variable}`}>
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <script {...jsonLdScriptProps(organizationJsonLd())} type="application/ld+json" />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <WhatsAppFloatingButton />

        {publicEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${publicEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${publicEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID}');
                window.gtag = gtag;`}
            </Script>
          </>
        )}

        {publicEnv.NEXT_PUBLIC_YANDEX_METRICA_ID && (
          <Script id="ym-init" strategy="afterInteractive">
            {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
              m[i].l=1*new Date();
              k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
              (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
              ym(${publicEnv.NEXT_PUBLIC_YANDEX_METRICA_ID}, "init", { defer: true });
              window.ym = ym;`}
          </Script>
        )}
      </body>
    </html>
  );
}
