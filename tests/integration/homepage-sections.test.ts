import { beforeAll, describe, expect, it } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { configurationToShareQuery, parseConfigurationFromSearchParams } from '@/lib/configurator/url';
import { isModelSlugPubliclyVisible } from '@/lib/config/launch-visibility';
import { shelvesLabel } from '@/lib/plural';
import { ProductCard } from '@/components/catalog/ProductCard';
import { ShelvingPreview } from '@/components/configurator/ShelvingPreview';
import HomePage from '@/app/[locale]/page';
import { localeProps, renderInLocale } from './helpers/public-page';
import type { CatalogProduct, ShelvingConfiguration } from '@/lib/types/domain';

/**
 * The homepage's two catalog-driven sections:
 *
 * "Популярные конфигурации" — the three most popular ready MS Standard
 * configurations. Which three is catalog data (`featured` + `popularity`),
 * and every price is whatever calculatePrice() returns for that
 * configuration against the current catalog; nothing here is a literal in
 * the page.
 *
 * "Категории стеллажей" — one feature panel per publicly visible model,
 * whose dimension ranges come from that model's own supported values.
 */

interface CardProps {
  product: CatalogProduct;
  configuration: ShelvingConfiguration;
  priceTotal: number | null;
  modelName: string;
  visual?: ReactElement;
}

/** Every element of `type` in a rendered server-component tree, in render order. */
function collectElements(node: unknown, type: unknown, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, type, found);
    return found;
  }
  if (!isValidElement(node)) return found;
  if (node.type === type) found.push(node);
  collectElements((node.props as { children?: unknown }).children, type, found);
  return found;
}

let catalog: Catalog;
let element: ReactElement;
let html: string;
let cards: CardProps[];

beforeAll(async () => {
  resetCatalogCache();
  catalog = await getCatalog();
  // The Russian homepage: the section assertions below are written in Russian.
  element = (await HomePage(localeProps('ru'))) as ReactElement;
  html = await renderInLocale(element, 'ru');
  cards = collectElements(element, ProductCard).map((el) => el.props as CardProps);
});

describe('"Популярные конфигурации"', () => {
  it('shows exactly three MS Standard configurations', () => {
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.product.modelSlug)).toEqual(['ms-standard', 'ms-standard', 'ms-standard']);
  });

  it('they are 2000×1000 with 4 shelves at depths 300, 400 and 600', () => {
    expect(cards.map((c) => c.product.depth)).toEqual([300, 400, 600]);
    for (const { product } of cards) {
      expect(product.height).toBe(2000);
      expect(product.width).toBe(1000);
      expect(product.shelves).toBe(4);
      expect(product.sections).toBe(1);
      expect(product.shelfType).toBe('STANDARD');
      expect(product.loadCapacity).toBe(150);
    }
  });

  it('each card renders its own dimensions, shelf count and load', () => {
    for (const { product } of cards) {
      expect(html).toContain(`${product.height}×${product.width}×${product.depth} мм`);
      // Russian count agreement: four shelves is "4 полки", never "4 полок".
      expect(html).toContain(shelvesLabel(product.shelves));
      expect(html).toContain('4 полки');
      expect(html).toContain(`${product.loadCapacity} кг/полка`);
    }
  });

  it('every card is drawn from its own configuration instead of the sample-image placeholder', () => {
    const cardPreviewConfigs = cards.map((card) => {
      expect(isValidElement(card.visual)).toBe(true);
      const previews = collectElements(card.visual, ShelvingPreview) as ReactElement<{
        config: ShelvingConfiguration;
      }>[];
      expect(previews).toHaveLength(1);
      return previews[0].props.config;
    });

    // Each drawing renders that card's own depth/shelves, not a shared rack.
    expect(cardPreviewConfigs.map((c) => c.depth)).toEqual([300, 400, 600]);
    for (const [index, config] of cardPreviewConfigs.entries()) {
      expect(config).toBe(cards[index].configuration);
      expect(config.shelves).toBe(4);
    }
  });

  it('renders no placeholder product image inside the popular-configurations cards', () => {
    for (const card of cards) expect(card.visual).toBeDefined();
    // ProductCard's catalog-photo fallback is the only thing that renders
    // this class; its absence means no card fell back to the placeholder.
    expect(html).not.toContain('bg-surface-muted object-cover');
  });

  it('every card configuration matches its own product exactly', () => {
    for (const { product, configuration } of cards) {
      expect(configuration.modelSlug).toBe(product.modelSlug);
      expect(configuration.height).toBe(product.height);
      expect(configuration.depth).toBe(product.depth);
      expect(configuration.shelves).toBe(product.shelves);
      expect(configuration.loadCapacity).toBe(product.loadCapacity);
      expect(configuration.shelfType).toBe(product.shelfType);
      expect(configuration.colorId).toBe(product.color);
      expect(configuration.sections).toHaveLength(product.sections);
      expect(configuration.sections.every((s) => s.width === product.width)).toBe(true);
    }
  });

  /** ProductCard posts its own `configuration` to /api/pricing/calculate and
   * puts the server's echo of it into the cart, so two cards sharing one
   * configuration object (or one section id) would put the wrong rack in the
   * cart the moment anything mutated it. */
  it('the three cards never share configuration state', () => {
    const configurations = cards.map((c) => c.configuration);
    expect(new Set(configurations).size).toBe(3);
    const sectionIds = configurations.flatMap((c) => c.sections.map((s) => s.id));
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
  });

  it('each "Настроить" link carries that card\'s exact configuration', () => {
    for (const { configuration } of cards) {
      const query = configurationToShareQuery(configuration);
      expect(html).toContain(`/configurator?${query.replace(/&/g, '&amp;')}`);

      const parsed = parseConfigurationFromSearchParams(new URLSearchParams(query));
      expect(parsed.modelSlug).toBe(configuration.modelSlug);
      expect(parsed.height).toBe(configuration.height);
      expect(parsed.depth).toBe(configuration.depth);
      expect(parsed.shelves).toBe(configuration.shelves);
      expect(parsed.sections?.map((s) => s.width)).toEqual(configuration.sections.map((s) => s.width));
    }
  });

  it('every displayed price is the pricing engine\'s current total, not a literal', () => {
    for (const { configuration, priceTotal } of cards) {
      const result = calculatePrice(configuration, catalog);
      expect(result.ok, 'a homepage configuration must be priceable').toBe(true);
      if (!result.ok) return;
      expect(priceTotal).toBe(result.breakdown.total);
      expect(priceTotal).toBeGreaterThan(0);
    }
  });

  it('a deeper rack costs more than a shallower one, so prices are per-configuration', () => {
    const totals = cards.map((c) => c.priceTotal ?? 0);
    expect(totals[0]).toBeLessThan(totals[1]);
    expect(totals[1]).toBeLessThan(totals[2]);
  });

  it('never exposes internal commercial fields', () => {
    for (const forbidden of ['markupPercent', 'markupFixed', 'purchasePrice', 'unitCost', 'supplierRef']) {
      expect(html).not.toContain(forbidden);
    }
  });
});

describe('"Категории стеллажей" feature panel', () => {
  const publicModels = () => catalog.models.filter((m) => isModelSlugPubliclyVisible(m.slug));

  it('renders one panel for the single public model, MS Standard', () => {
    const models = publicModels();
    expect(models.map((m) => m.slug)).toEqual(['ms-standard']);
    expect(html).toContain(models[0].name.ru);
    expect(html).toContain(models[0].description.ru);
  });

  it('shows the dimension ranges of the model\'s own supported values', () => {
    const model = publicModels()[0];
    const range = (values: number[]) => `${Math.min(...values)}–${Math.max(...values)} мм`;

    // The ranges the panel prints are the model row's values, and for MS
    // Standard those are exactly these — a change to the model's supported
    // dimensions must move the homepage with it.
    expect(range(model.heights)).toBe('1000–3000 мм');
    expect(range(model.widths)).toBe('700–1500 мм');
    expect(range(model.depths)).toBe('300–800 мм');
    expect(model.maxLoadKg).toBe(150);

    for (const label of ['Высота', 'Ширина', 'Глубина', 'Нагрузка']) expect(html).toContain(label);
    expect(html).toContain(range(model.heights));
    expect(html).toContain(range(model.widths));
    expect(html).toContain(range(model.depths));
    expect(html).toContain(`до ${model.maxLoadKg} кг/полку`);
  });

  it('renders a real configuration drawing, not a sample-image placeholder', () => {
    // The configurator's own SVG renderer (ShelvingPreview) draws the panel's
    // visual, so there is no static product shot to keep in sync.
    expect(html).toContain('<svg');
    expect(html).not.toContain('/images/gallery/');
  });

  it('both CTAs point at live public routes for that model', () => {
    const model = publicModels()[0];
    expect(html).toContain(`href="/ru/configurator?model=${model.slug}"`);
    expect(html).toContain(`href="/ru/catalog/${model.slug}"`);
    expect(html).toContain('Настроить стеллаж');
    expect(html).toContain('Смотреть модели');
    expect(isModelSlugPubliclyVisible(model.slug)).toBe(true);
  });

  it('keeps the section heading', () => {
    expect(html).toContain('Категории стеллажей');
  });
});

describe('hidden models stay off the homepage', () => {
  it.each(['ms-strong', 'archive-ms'])('%s is absent from every homepage section', (slug) => {
    expect(html).not.toContain(`/catalog/${slug}`);
    expect(html).not.toContain(`/images/models/${slug}.svg`);
    expect(cards.some((c) => c.product.modelSlug === slug)).toBe(false);
  });
});
