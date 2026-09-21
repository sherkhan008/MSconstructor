import { publicEnv } from '@/lib/env';

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

export const site = {
  /** Brand, not the seller — see the note above. */
  name: 'MS Стеллажи',
  /** Legal seller. Appears only in legal/реквизиты blocks. */
  legalName: 'ИП "ГИДРОПРОЕКТ"',
  tagline: 'Модульные металлические стеллажи',
  shortDescription:
    'Модульные металлические стеллажи MS для склада, архива, гаража и офиса. Конфигуратор с мгновенным расчётом цены. Доставка по Казахстану.',
  locale: 'ru_KZ',
  country: 'KZ',
  currency: 'KZT',
  currencySymbol: '₸',

  whatsapp: whatsappNumber,
  whatsappDisplay: formatKzNumber(whatsappNumber),
  email: 'serdalybakrambek2@gmail.com',
  address: 'г. Астана, ул. А. Иманова, 19',
  city: 'Астана',
  workingHours: 'Пн–Пт 09:00–18:00',
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

export const NAV_LINKS = [
  { href: '/catalog', labelRu: 'Каталог', labelKk: 'Каталог' },
  { href: '/configurator', labelRu: 'Конфигуратор', labelKk: 'Конфигуратор' },
  { href: '/delivery', labelRu: 'Доставка и оплата', labelKk: 'Жеткізу және төлем' },
  { href: '/contacts', labelRu: 'Контакты', labelKk: 'Байланыс' },
] as const;

export const FOOTER_LINKS = [
  { href: '/catalog', labelRu: 'Каталог стеллажей' },
  { href: '/configurator', labelRu: 'Конфигуратор' },
  { href: '/delivery', labelRu: 'Доставка' },
  { href: '/payment', labelRu: 'Оплата' },
  { href: '/contacts', labelRu: 'Контакты' },
  { href: '/privacy', labelRu: 'Политика конфиденциальности' },
  { href: '/terms', labelRu: 'Публичная оферта' },
] as const;
