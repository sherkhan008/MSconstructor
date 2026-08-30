import { publicEnv } from '@/lib/env';

/**
 * Company / site level configuration.
 * Replace these placeholder contact details with the real ones before launch.
 */

/** wa.me only accepts digits (country code + number, no "+"/spaces/punctuation) —
 * sanitise whatever was typed into the env var so a stray "+7 (707)..." style
 * value can never produce a broken wa.me link. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

// TODO(production): set NEXT_PUBLIC_WHATSAPP_NUMBER to the real company
// WhatsApp number (digits only, with country code, e.g. "77071234567") in
// the production environment. This placeholder is not a real number — every
// wa.me link generated from it is non-functional until it's replaced.
const WHATSAPP_PLACEHOLDER = '77718646702';

const whatsappNumber = publicEnv.NEXT_PUBLIC_WHATSAPP_NUMBER
  ? digitsOnly(publicEnv.NEXT_PUBLIC_WHATSAPP_NUMBER)
  : WHATSAPP_PLACEHOLDER;

export const site = {
  name: 'MS Стеллажи',
  legalName: 'ТОО «MS Стеллаж Казахстан»',
  tagline: 'Модульные металлические стеллажи',
  shortDescription:
    'Модульные металлические стеллажи MS для склада, архива, гаража и офиса. Конфигуратор с мгновенным расчётом цены. Доставка по Казахстану.',
  locale: 'ru_KZ',
  country: 'KZ',
  currency: 'KZT',
  currencySymbol: '₸',

  phone: '+7 (771) 864-67-02',
  phoneHref: '+77718646702',
  whatsapp: whatsappNumber,
  email: 'sales@ms-stellazh.kz',
  address: 'г. Астана, ул. Алаш, 22',
  city: 'Алматы',
  postalCode: '010000',
  workingHours: 'Пн–Пт 09:00–18:00',
  bin: '000000000000',

  // Placeholder map embed — replace with the real 2GIS / Yandex widget.
  mapEmbedUrl: '',
  geo: { lat: 43.238949, lng: 76.889709 },

  social: {
    instagram: 'https://instagram.com/',
    telegram: 'https://t.me/',
  },
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
