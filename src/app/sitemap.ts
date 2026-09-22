import type { MetadataRoute } from 'next';
import { getCatalog } from '@/lib/data/repository';
import { isModelSlugPubliclyVisible } from '@/lib/config/launch-visibility';
import { LOCALES, localizePath } from '@/lib/i18n/locales';
import { absoluteUrl, localeAlternates } from '@/lib/seo';

// Reads the runtime catalog, so it renders per request — never prerendered
// during `next build`. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

type Page = { path: string; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number };

/**
 * Only public, indexable marketing/catalog routes belong here. Admin routes,
 * API routes, the cart/order flow and anything containing customer data are
 * intentionally excluded (see the noIndex robots directive on those pages).
 *
 * Every page is listed once per public locale — the Kazakh root URL and its
 * /ru twin — and each entry carries the same hreflang pairing the page's own
 * <head> declares (alternates.languages).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = await getCatalog();
  const now = new Date();

  const pages: Page[] = [
    { path: '/', changeFrequency: 'weekly', priority: 1 },
    { path: '/catalog', changeFrequency: 'daily', priority: 0.9 },
    { path: '/configurator', changeFrequency: 'weekly', priority: 0.9 },
    { path: '/delivery', changeFrequency: 'monthly', priority: 0.5 },
    { path: '/payment', changeFrequency: 'monthly', priority: 0.4 },
    { path: '/contacts', changeFrequency: 'monthly', priority: 0.5 },
    { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
    { path: '/terms', changeFrequency: 'yearly', priority: 0.2 },
    ...catalog.models
      .filter((m) => m.active && isModelSlugPubliclyVisible(m.slug))
      .map((model): Page => ({ path: `/catalog/${model.slug}`, changeFrequency: 'weekly', priority: 0.8 })),
  ];

  return pages.flatMap((page) =>
    LOCALES.map((locale) => ({
      url: absoluteUrl(localizePath(page.path, locale)),
      lastModified: now,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
      alternates: { languages: localeAlternates(page.path) },
    })),
  );
}
