import type { Metadata } from 'next';
import { appUrl } from '@/lib/env';
import { site } from '@/lib/config/site';

/** Builds page metadata with the site-wide defaults already applied. */
export function buildMetadata(input: {
  title: string;
  description: string;
  path: string;
  image?: string;
  noIndex?: boolean;
}): Metadata {
  const url = new URL(input.path, appUrl).toString();
  const image = input.image ?? '/images/models/ms-standard.svg';

  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    robots: input.noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: input.title,
      description: input.description,
      url,
      siteName: site.name,
      locale: 'ru_KZ',
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

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.legalName,
    alternateName: site.name,
    url: appUrl,
    logo: new URL('/images/models/ms-standard.svg', appUrl).toString(),
    telephone: site.phoneHref,
    email: site.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address,
      addressLocality: site.city,
      postalCode: site.postalCode,
      addressCountry: 'KZ',
    },
    sameAs: Object.values(site.social),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: new URL(item.path, appUrl).toString(),
    })),
  };
}

export function productJsonLd(input: {
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
    brand: { '@type': 'Brand', name: site.name },
    offers: {
      '@type': 'Offer',
      url: new URL(input.path, appUrl).toString(),
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
