/**
 * Company / site level configuration.
 * Replace these placeholder contact details with the real ones before launch.
 */

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

  phone: '+7 (700) 000-00-00',
  phoneHref: '+77000000000',
  whatsapp: '77000000000',
  email: 'sales@ms-stellazh.kz',
  address: 'г. Алматы, ул. Промышленная, 15, склад №3',
  city: 'Алматы',
  postalCode: '050000',
  workingHours: 'Пн–Пт 09:00–18:00, Сб 10:00–15:00',
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
