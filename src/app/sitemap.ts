import type { MetadataRoute } from 'next';
import { getCatalog } from '@/lib/data/repository';
import { appUrl } from '@/lib/env';

// Reads the runtime catalog, so it renders per request — never prerendered
// during `next build`. See getCatalog() in src/lib/data/repository.ts.
export const dynamic = 'force-dynamic';

/**
 * Only public, indexable marketing/catalog routes belong here. Admin routes,
 * API routes, the cart/order flow and anything containing customer data are
 * intentionally excluded (see the noIndex robots directive on those pages).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = await getCatalog();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: appUrl, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${appUrl}/catalog`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${appUrl}/configurator`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${appUrl}/delivery`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${appUrl}/payment`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${appUrl}/contacts`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${appUrl}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${appUrl}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];

  const modelRoutes: MetadataRoute.Sitemap = catalog.models
    .filter((m) => m.active)
    .map((model) => ({
      url: `${appUrl}/catalog/${model.slug}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    }));

  return [...staticRoutes, ...modelRoutes];
}
