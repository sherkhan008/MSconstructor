import { describe, expect, it } from 'vitest';
import { whatsAppConfiguratorUrl, whatsAppContactUrl, whatsAppOrderUrl, whatsAppProductUrl } from '@/lib/whatsapp';
import { site } from '@/lib/config/site';
import type { PublicAccessory, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import type { PublicPriceResult } from '@/lib/pricing/public-result';

function section(width: number, overrides: Partial<ShelvingSection> = {}): ShelvingSection {
  return { id: `sec-${width}-${Math.random().toString(36).slice(2, 6)}`, width, rearWall: false, leftWall: false, rightWall: false, ...overrides };
}

function baseConfig(overrides: Partial<ShelvingConfiguration> = {}): ShelvingConfiguration {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 500,
    shelves: 5,
    sections: [section(1000)],
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    ...overrides,
  };
}

function priceResult(config: ShelvingConfiguration, total = 374_859): PublicPriceResult {
  const result = {
    ok: true as const,
    configuration: config,
    bom: [],
    breakdown: {
      // Not part of the public shape any more, but a stale cart snapshot
      // persisted in a browser before that change can still carry it at
      // runtime — it must never leak into the WhatsApp message.
      markup: 45_000,
      unitNet: total,
      quantity: 1,
      itemsNet: total,
      assembly: 0,
      delivery: 0,
      discount: 0,
      discountReasons: [],
      net: total,
      vatPercent: 12,
      vat: 12_000, // must never leak either
      total,
      unitTotal: total,
    },
    totalWeightKg: 40,
    rowLengthMm: 1000,
    leadTimeDays: 2,
    deliveryNote: null,
    warnings: [],
  };
  return result as PublicPriceResult;
}

const ACCESSORIES: PublicAccessory[] = [
  {
    id: 'acc-adjustable-feet',
    sku: 'ACC-0011',
    slug: 'adjustable-feet',
    name: { ru: 'Регулируемые опоры', kk: 'Реттелетін тіректер' },
    description: { ru: 'desc', kk: 'desc' },
    image: '/img.svg',
    weightKg: 0.4,
    models: [],
    inStock: true,
    sortOrder: 10,
    active: true,
  },
  {
    id: 'acc-shelf-reinforcement',
    sku: 'ACC-0002',
    slug: 'shelf-reinforcement',
    name: { ru: 'Усиление полки', kk: 'Сөрені күшейту' },
    description: { ru: 'desc', kk: 'desc' },
    image: '/img.svg',
    weightKg: 1.4,
    models: [],
    maxQuantityPerSection: 8,
    inStock: true,
    sortOrder: 1,
    active: true,
  },
  {
    id: 'acc-cross-brace',
    sku: 'ACC-0005',
    slug: 'cross-brace',
    name: { ru: 'Крестовина жёсткости', kk: 'Қатаңдық айқышы' },
    description: { ru: 'desc', kk: 'desc' },
    image: '/img.svg',
    weightKg: 1.8,
    models: [],
    inStock: true,
    sortOrder: 4,
    active: true,
  },
];

function decodeMessage(url: string): string {
  const query = url.split('?')[1] ?? '';
  const params = new URLSearchParams(query);
  return params.get('text') ?? '';
}

describe('whatsAppConfiguratorUrl', () => {
  it('uses the configured company number and points at wa.me', () => {
    const url = whatsAppConfiguratorUrl(priceResult(baseConfig()), [], 'https://example.com/configurator?height=2000');
    expect(url.startsWith(`https://wa.me/${site.whatsapp}?`)).toBe(true);
  });

  it('includes real height/depth/shelves/load for a single section', () => {
    const config = baseConfig({ height: 2000, depth: 500, shelves: 5, loadCapacity: 150, sections: [section(1000)] });
    const message = decodeMessage(whatsAppConfiguratorUrl(priceResult(config), [], 'https://example.com/x'));
    expect(message).toContain('Высота: 2000 мм');
    expect(message).toContain('Глубина: 500 мм');
    expect(message).toContain('Секций: 1');
    expect(message).toContain('Ширина секций: 1000 мм');
    expect(message).toContain('Полок: 5');
    expect(message).toContain('Нагрузка: 150 кг/полку');
  });

  it('joins three mixed section widths with " + "', () => {
    const config = baseConfig({ sections: [section(700), section(1000), section(1200)] });
    const message = decodeMessage(whatsAppConfiguratorUrl(priceResult(config), [], 'https://example.com/x'));
    expect(message).toContain('Секций: 3');
    expect(message).toContain('Ширина секций: 700 + 1000 + 1200 мм');
  });

  it('includes a compact per-section wall summary only when a wall is actually selected', () => {
    const config = baseConfig({
      sections: [
        section(700, { rearWall: true }),
        section(1000),
        section(1200, { leftWall: true, rightWall: true }),
      ],
    });
    const message = decodeMessage(whatsAppConfiguratorUrl(priceResult(config), [], 'https://example.com/x'));
    expect(message).toContain('Секция 1: задняя стенка');
    expect(message).toContain('Секция 2: без стенок');
    expect(message).toContain('Секция 3: левая + правая стенка');
  });

  it('omits the wall block entirely when no section has any wall', () => {
    const config = baseConfig({ sections: [section(700), section(1000)] });
    const message = decodeMessage(whatsAppConfiguratorUrl(priceResult(config), [], 'https://example.com/x'));
    expect(message).not.toContain('Секция 1:');
    expect(message).not.toContain('стенк');
  });

  it('lists selected additional options by their real customer-facing names, not ids/SKUs', () => {
    const target = baseConfig().sections[0];
    const config = baseConfig({
      sections: [target],
      accessories: [
        { accessoryId: 'acc-shelf-reinforcement', quantity: 5 },
        { accessoryId: 'acc-cross-brace', quantity: 1, sectionId: target.id },
      ],
      metalFootPad: true,
    });
    const message = decodeMessage(whatsAppConfiguratorUrl(priceResult(config), ACCESSORIES, 'https://example.com/x'));
    expect(message).toContain('Дополнительные параметры:');
    expect(message).toContain('- Усиление полки');
    expect(message).toContain('- Крестовина жёсткости');
    expect(message).toContain('- Металлический подпятник');
    expect(message).not.toContain('acc-cross-brace');
    expect(message).not.toContain('acc-shelf-reinforcement');
    expect(message).not.toContain('SKU');
    expect(message).not.toContain('ACC-0005');
  });

  it('collapses a cross brace applied to two different qualifying sections into one line', () => {
    const s1 = section(1000);
    const s2 = section(1000);
    const config = baseConfig({
      sections: [s1, s2],
      accessories: [
        { accessoryId: 'acc-cross-brace', quantity: 1, sectionId: s1.id },
        { accessoryId: 'acc-cross-brace', quantity: 1, sectionId: s2.id },
      ],
    });
    const message = decodeMessage(whatsAppConfiguratorUrl(priceResult(config), ACCESSORIES, 'https://example.com/x'));
    const occurrences = message.split('Крестовина жёсткости').length - 1;
    expect(occurrences).toBe(1);
  });

  it('omits the additional-options block entirely when nothing is selected', () => {
    const message = decodeMessage(whatsAppConfiguratorUrl(priceResult(baseConfig()), ACCESSORIES, 'https://example.com/x'));
    expect(message).not.toContain('Дополнительные параметры');
  });

  it('formats the final total using the real server-calculated price, space-grouped with the currency symbol', () => {
    const message = decodeMessage(whatsAppConfiguratorUrl(priceResult(baseConfig(), 374_859), [], 'https://example.com/x'));
    expect(message).toContain('Итого: 374 859 ₸');
  });

  it('includes the exact share URL passed in, not a reconstructed one', () => {
    const shareUrl = 'https://ms-stellazh.kz/configurator?model=ms-standard&height=2000&sections=1000%3A0%3A0%3A0';
    const message = decodeMessage(whatsAppConfiguratorUrl(priceResult(baseConfig()), [], shareUrl));
    expect(message).toContain('Ссылка на конфигурацию:');
    expect(message).toContain(shareUrl);
  });

  it('URL-encodes the generated message correctly, including special characters', () => {
    const url = whatsAppConfiguratorUrl(priceResult(baseConfig(), 374_859), [], 'https://example.com/x?a=1&b=2');
    // The raw query string must not contain a literal newline, and the
    // share URL's own "&"/"?"/"=" must be safely nested inside the single
    // encoded "text" parameter rather than reappearing as top-level params.
    const [, query] = url.split('?text=');
    expect(query).toBeDefined();
    expect(query).not.toContain('\n');
    expect(new URL(url).searchParams.getAll('a')).toEqual([]);
    expect(new URL(url).searchParams.getAll('b')).toEqual([]);
    const decoded = decodeMessage(url);
    expect(decoded).toContain('Итого: 374 859 ₸');
    expect(decoded).toContain('https://example.com/x?a=1&b=2');
  });

  it('never exposes purchase price, markup, margin, VAT or an internal SKU', () => {
    const config = baseConfig({
      accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: baseConfig().sections[0].id }],
    });
    const message = decodeMessage(whatsAppConfiguratorUrl(priceResult(config), ACCESSORIES, 'https://example.com/x'));
    expect(message).not.toContain('markup');
    expect(message).not.toContain('Наценка');
    expect(message).not.toContain('margin');
    expect(message).not.toContain('Маржа');
    expect(message).not.toContain('НДС');
    expect(message).not.toContain('45000');
    expect(message).not.toContain('45 000');
    expect(message).not.toContain('12000');
    expect(message).not.toContain('ACC-0005');
    expect(message).not.toContain('purchasePrice');
  });
});

describe('whatsAppOrderUrl', () => {
  it('includes the order number', () => {
    const message = decodeMessage(whatsAppOrderUrl('MS-20260827-00042'));
    expect(message).toContain('№MS-20260827-00042');
  });

  it('includes the final total when provided, formatted like the rest of the site', () => {
    const message = decodeMessage(whatsAppOrderUrl('MS-20260827-00042', 374_859));
    expect(message).toContain('Сумма заказа: 374 859 ₸');
  });

  it('omits the total line rather than guessing when no total is available', () => {
    const message = decodeMessage(whatsAppOrderUrl('MS-20260827-00042'));
    expect(message).not.toContain('Сумма заказа');
  });
});

describe('whatsAppContactUrl / whatsAppProductUrl', () => {
  it('uses the improved default contact message', () => {
    const message = decodeMessage(whatsAppContactUrl());
    expect(message).toBe('Здравствуйте! Хочу узнать подробнее о металлических стеллажах.');
  });

  it('accepts a custom message', () => {
    const message = decodeMessage(whatsAppContactUrl('Custom text'));
    expect(message).toBe('Custom text');
  });

  it('includes the model name and product URL', () => {
    const message = decodeMessage(whatsAppProductUrl('MS Стандарт', 'https://example.com/catalog/ms-standard'));
    expect(message).toContain('MS Стандарт');
    expect(message).toContain('https://example.com/catalog/ms-standard');
  });
});

describe('the configured WhatsApp number', () => {
  it('contains digits only — no "+", spaces, parentheses or hyphens', () => {
    expect(/^\d+$/.test(site.whatsapp)).toBe(true);
  });
});
