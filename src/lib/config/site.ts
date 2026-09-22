import { publicEnv } from '@/lib/env';
import type { Locale } from '@/lib/i18n/locales';
import { F, G, H } from '@/lib/i18n/strings';

/**
 * Company / site level configuration.
 *
 * Two different names live here and must not be conflated:
 *   `name`      — the customer-facing BRAND ("MS Стеллажи"), used for the
 *                 logo, page titles, Open Graph and the product brand.
 *   `legalName` — the LEGAL SELLER (ИП "ГИДРОПРОЕКТ"), used only where a
 *                 legal block identifies who sells: the offer, the privacy
 *                 policy, the footer's реквизиты and Organization JSON-LD.
 *
 * There is deliberately no `phone`: the seller publishes no voice number, and
 * a placeholder one on a public offer is worse than none. WhatsApp is the
 * public contact channel (`whatsapp`/`whatsappDisplay`, from
 * NEXT_PUBLIC_WHATSAPP_NUMBER) — it is a messaging handle, never rendered as
 * a `tel:` link.
 *
 * Banking details (IBAN, BIC, bank name) are NOT here and never public: they
 * live in server-only SELLER_* variables and reach invoices alone
 * (src/lib/documents/seller.ts).
 */

/** wa.me only accepts digits (country code + number, no "+"/spaces/punctuation) —
 * sanitise whatever was typed into the env var so a stray "+7 (707)..." style
 * value can never produce a broken wa.me link. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

// Local-development fallback only, so a fresh checkout renders without any
// environment at all. It is a reserved, unassignable number: every wa.me
// link built from it is non-functional by design, and it is deliberately not
// any number this site has ever published. Production can never reach it —
// a missing NEXT_PUBLIC_WHATSAPP_NUMBER stops startup outright, because
// WhatsApp is the seller's only public contact channel
// (src/lib/startup/production-config.ts).
const WHATSAPP_DEV_FALLBACK = '70000000000';

const whatsappNumber = publicEnv.NEXT_PUBLIC_WHATSAPP_NUMBER
  ? digitsOnly(publicEnv.NEXT_PUBLIC_WHATSAPP_NUMBER)
  : WHATSAPP_DEV_FALLBACK;

/** "77071078235" → "+7 707 107 8235". Display only — links use the digits. */
function formatKzNumber(digits: string): string {
  const m = /^7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(digits);
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]}${m[4]}` : `+${digits}`;
}

/**
 * Site identity. The text fields hold the Russian copy (the admin panel and
 * order documents are Russian-only); public pages read the per-locale copy
 * through siteCopy() below. Both come from the owner-reviewed CSV
 * (docs/localization/public-strings.csv, G-001…G-007).
 */
export const site = {
  /** Brand, not the seller — see the note above. */
  name: G['G-001'].ru,
  /** Legal seller. Appears only in legal/реквизиты blocks. Never translated. */
  legalName: G['G-002'].ru,
  tagline: G['G-003'].ru,
  shortDescription: G['G-004'].ru,
  country: 'KZ',
  currency: 'KZT',
  currencySymbol: '₸',

  whatsapp: whatsappNumber,
  whatsappDisplay: formatKzNumber(whatsappNumber),
  email: 'serdalybakrambek2@gmail.com',
  address: G['G-005'].ru,
  city: G['G-006'].ru,
  workingHours: G['G-007'].ru,
  bin: '970115300155',

  // No map is rendered anywhere today: /, /contacts show the verified
  // address from `address` above and nothing else. Until a real 2GIS/Yandex
  // widget URL is supplied, this stays empty and no map area is drawn — a
  // customer must never be shown an empty frame or a note addressed to a
  // developer. Wiring an embed up is a deliberate future change, here and at
  // the call site.
  // No `geo`, `postalCode` or `social`: the seller has supplied no
  // coordinates, postal index or social profiles, and structured data must
  // not assert any of them.
  mapEmbedUrl: '',
} as const;

/** Customer-facing site copy in `locale` (brand, slogan, address, hours). */
export function siteCopy(locale: Locale) {
  return {
    name: G['G-001'][locale],
    tagline: G['G-003'][locale],
    shortDescription: G['G-004'][locale],
    address: G['G-005'][locale],
    city: G['G-006'][locale],
    workingHours: G['G-007'][locale],
  };
}

export const NAV_LINKS = [
  { href: '/catalog', labelRu: H['H-002'].ru, labelKk: H['H-002'].kk },
  { href: '/configurator', labelRu: H['H-003'].ru, labelKk: H['H-003'].kk },
  { href: '/delivery', labelRu: H['H-004'].ru, labelKk: H['H-004'].kk },
  { href: '/contacts', labelRu: H['H-005'].ru, labelKk: H['H-005'].kk },
] as const;

export const FOOTER_LINKS = [
  { href: '/catalog', labelRu: F['F-004'].ru, labelKk: F['F-004'].kk },
  { href: '/configurator', labelRu: H['H-003'].ru, labelKk: H['H-003'].kk },
  { href: '/delivery', labelRu: F['F-005'].ru, labelKk: F['F-005'].kk },
  { href: '/payment', labelRu: F['F-006'].ru, labelKk: F['F-006'].kk },
  { href: '/contacts', labelRu: H['H-005'].ru, labelKk: H['H-005'].kk },
  { href: '/privacy', labelRu: F['F-007'].ru, labelKk: F['F-007'].kk },
  { href: '/terms', labelRu: F['F-008'].ru, labelKk: F['F-008'].kk },
] as const;

/** A NAV_LINKS / FOOTER_LINKS label in `locale`. */
export function linkLabel(link: { labelRu: string; labelKk: string }, locale: Locale): string {
  return locale === 'kk' ? link.labelKk : link.labelRu;
}
