import type { Metadata } from 'next';
import { appUrl } from '@/lib/env';
import { site, siteCopy } from '@/lib/config/site';
import { LOCALES, OG_LOCALE, localizePath, type Locale } from '@/lib/i18n/locales';

/** Absolute URL of a site path. */
export function absoluteUrl(path: string): string {
  return new URL(path, appUrl).toString();
}

/**
 * hreflang alternates of one public page: every locale's URL of the same
 * locale-neutral `path`, plus x-default → the Kazakh (unprefixed) URL, which
 * is what a visitor without a language preference gets at the root.
 */
export function localeAlternates(path: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of LOCALES) languages[locale] = absoluteUrl(localizePath(path, locale));
  languages['x-default'] = absoluteUrl(localizePath(path, 'kk'));
  return languages;
}

/**
 * Builds page metadata with the site-wide defaults already applied.
 *
 * Public pages pass `locale` and a locale-neutral `path` ('/catalog'): the
 * canonical is that page in its own locale (a Russian page is never
 * canonicalized to Kazakh) and `alternates.languages` pairs it with its
 * other-language twin. Without `locale` (the Russian-only admin panel), or on
 * a noIndex page, no language alternates are emitted.
 */
export function buildMetadata(input: {
  title: string;
  description: string;
  path: string;
  locale?: Locale;
  image?: string;
  noIndex?: boolean;
}): Metadata {
  const locale = input.locale ?? 'ru';
  const url = absoluteUrl(input.locale ? localizePath(input.path, input.locale) : input.path);
  const image = input.image ?? '/images/models/ms-standard.svg';

  return {
    title: input.title,
    description: input.description,
    // Non-indexable pages (cart, checkout, order success) get no hreflang: there
    // is no indexable language pair to announce.
    alternates: input.locale && !input.noIndex ? { canonical: url, languages: localeAlternates(input.path) } : { canonical: url },
    robots: input.noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: input.title,
      description: input.description,
      url,
      siteName: siteCopy(locale).name,
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      type: 'website',
      images: [{ url: new URL(image, appUrl).toString() }],
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
      images: [image],
    },
  };
}

/**
 * The legal seller as an Organization: legal name, BIN, address and public
 * email — the same identity the public offer carries. The legal name and BIN
 * are never translated; the brand and address follow the page locale.
 * Deliberately absent:
 * `telephone` (the seller publishes no voice number, and schema.org must not
 * be fed a fabricated one), `postalCode`, `geo` and `sameAs`. Banking details
 * never appear here — they are server-only and belong on invoices alone.
 */
export function organizationJsonLd(locale: Locale) {
  const copy = siteCopy(locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.legalName,
    alternateName: copy.name,
    url: absoluteUrl(localizePath('/', locale)),
    logo: new URL('/images/models/ms-standard.svg', appUrl).toString(),
    taxID: site.bin,
    email: site.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: copy.address,
      addressLocality: copy.city,
      addressCountry: 'KZ',
    },
  };
}

/** `path`s are locale-neutral; they are emitted as `locale` URLs. */
export function breadcrumbJsonLd(items: { name: string; path: string }[], locale: Locale) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(localizePath(item.path, locale)),
    })),
  };
}

export function productJsonLd(input: {
  locale: Locale;
  name: string;
  description: string;
  image: string;
  sku: string;
  path: string;
  price: number;
  availability?: 'InStock' | 'OutOfStock';
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    description: input.description,
    image: new URL(input.image, appUrl).toString(),
    sku: input.sku,
    brand: { '@type': 'Brand', name: siteCopy(input.locale).name },
    offers: {
      '@type': 'Offer',
      url: absoluteUrl(localizePath(input.path, input.locale)),
      priceCurrency: site.currency,
      price: input.price,
      availability: `https://schema.org/${input.availability ?? 'InStock'}`,
    },
  };
}

export function faqJsonLd(items: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

/** Renders a JSON-LD payload safely — callers pass the object, not raw HTML. */
export function jsonLdScriptProps(data: unknown) {
  return { dangerouslySetInnerHTML: { __html: JSON.stringify(data) } };
}
