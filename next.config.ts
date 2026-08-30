import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 * CSP is intentionally strict; 'unsafe-inline' for styles is required by Next.js
 * inline critical CSS, and 'unsafe-eval' is only enabled in development for HMR.
 */
const isDev = process.env.NODE_ENV === 'development';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://www.googletagmanager.com https://mc.yandex.ru`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://mc.yandex.ru https://www.google-analytics.com",
  "connect-src 'self' https://www.google-analytics.com https://mc.yandex.ru",
  "frame-src 'self' https://yandex.ru https://www.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  // `next dev` only ever serves plain HTTP (including over a LAN IP, where
  // browsers — unlike on localhost — apply no HTTPS-upgrade exception).
  // Sending this directive there upgrades /_next/static/* and the HMR
  // socket to https:// URLs the dev server never listens on, so CSS/JS/HMR
  // silently fail while the already-fetched HTML still renders.
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  // HSTS only makes sense once the app is actually served over HTTPS.
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lean, self-contained production image for Docker (see Dockerfile).
  output: 'standalone',
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [320, 375, 390, 430, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [64, 96, 128, 256, 384],
    // Product photography placeholders ship as SVG until real photos are uploaded.
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  experimental: {
    optimizePackageImports: ['zustand'],
  },
};

export default nextConfig;
