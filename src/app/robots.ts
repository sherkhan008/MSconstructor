import type { MetadataRoute } from 'next';
import { appUrl } from '@/lib/env';

// Host and Sitemap come from the runtime APP_URL; the production image is
// built without it (Dockerfile), so a prerendered robots.txt would point
// crawlers at http://localhost:3000. Rendered per request instead.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The cart/checkout flow exists in both public locales (/… and /ru/…).
        disallow: ['/admin', '/api', '/cart', '/order', '/order/success', '/ru/cart', '/ru/order', '/ru/order/success'],
      },
    ],
    sitemap: `${appUrl}/sitemap.xml`,
    host: appUrl,
  };
}
