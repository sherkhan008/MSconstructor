import { IBM_Plex_Mono, Inter } from 'next/font/google';

/**
 * Site fonts, shared by both root layouts: the public site
 * (src/app/[locale]/layout.tsx) and the admin panel (src/app/admin/layout.tsx).
 * Inter is both the body and the heading face (see --font-display in
 * globals.css); IBM Plex Mono sets technical values.
 * `cyrillic-ext` covers the Kazakh letters (ә ғ қ ң ө ұ ү һ і).
 */
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

export const fontVariables = `${inter.variable} ${plexMono.variable}`;
