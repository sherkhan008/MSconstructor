import type { MetadataRoute } from 'next';
import { appUrl } from '@/lib/env';

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
