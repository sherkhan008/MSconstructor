import { beforeAll, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { calculatePrice } from '@/lib/pricing';
import { catalogProductToConfiguration } from '@/lib/catalog-product-configuration';
import { getAllowedDepthsForWidth, getMaxShelvesForHeight } from '@/lib/pricing/ms-standard-compatibility';
import { isModelSlugPubliclyVisible } from '@/lib/config/launch-visibility';
import { formatPrice } from '@/lib/money';
import { t } from '@/lib/i18n/format';
import { LOCALES, type Locale } from '@/lib/i18n/locales';
import { HM, PR } from '@/lib/i18n/strings';
import CatalogPage from '@/app/[locale]/catalog/page';
import ModelPage from '@/app/[locale]/catalog/[model]/page';
import { localeProps, renderInLocale } from './helpers/public-page';

/**
 * The storefront catalog and the MS Standard model page: every price they
 * show is the server pricing engine's result for a real ready configuration,
 * every size they list comes from the model's catalog row or the MS Standard
 * compatibility matrix, and both lead into the configurator in the page
 * language. Nothing about hidden models reaches either page.
 */

let catalog: Catalog;

beforeAll(async () => {
  resetCatalogCache();
  catalog = await getCatalog();
});

/** Lowest calculatePrice() total over the model's published ready configurations. */
function fromPrice(slug: string): number {
  const totals = catalog.products
    .filter((p) => p.modelSlug === slug && p.published)
    .map((p) => calculatePrice(catalogProductToConfiguration(p), catalog))
    .flatMap((r) => (r.ok ? [r.breakdown.total] : []));
  expect(totals.length).toBeGreaterThan(0);
  return Math.min(...totals);
}

const hiddenModels = () => catalog.models.filter((m) => !isModelSlugPubliclyVisible(m.slug));

async function catalogHtml(locale: Locale) {
  return renderInLocale((await CatalogPage(localeProps(locale))) as ReactElement, locale);
}

async function modelHtml(locale: Locale) {
  return renderInLocale((await ModelPage(localeProps(locale, { model: 'ms-standard' }))) as ReactElement, locale);
}

describe.each(LOCALES)('catalog page (%s)', (locale) => {
  const prefix = locale === 'ru' ? '/ru' : '';

  it('presents MS Standard with its server-calculated from-price and both next steps', async () => {
    const html = await catalogHtml(locale);
    expect(html).toContain(t(PR['PR-005'], locale, { price: formatPrice(fromPrice('ms-standard')) }));
    // Configure/buy (primary) and learn about the model (secondary), in the page language.
    expect(html).toContain(`href="${prefix}/configurator?model=ms-standard"`);
    expect(html).toContain(`href="${prefix}/catalog/ms-standard"`);
    expect(html).toContain(t(HM['HM-032'], locale));
    expect(html).toContain(t(HM['HM-033'], locale));
  });

  it('never names or links a hidden model', async () => {
    const html = await catalogHtml(locale);
    for (const model of hiddenModels()) {
      expect(html).not.toContain(`/catalog/${model.slug}`);
      expect(html).not.toContain(`model=${model.slug}`);
      expect(html).not.toContain(model.name[locale]);
    }
  });
});

describe.each(LOCALES)('MS Standard model page (%s)', (locale) => {
  const prefix = locale === 'ru' ? '/ru' : '';

  it('shows the server-calculated from-price and leads into the configurator in the page language', async () => {
    const html = await modelHtml(locale);
    expect(html).toContain(t(PR['PR-005'], locale, { price: formatPrice(fromPrice('ms-standard')) }));
    expect(html).toContain(`href="${prefix}/configurator?model=ms-standard"`);
    expect(html).toContain(t(PR['PR-006'], locale));
  });

  it('lists exactly the width→depth and height→shelves combinations of the compatibility matrix', async () => {
    const html = await modelHtml(locale);
    const model = catalog.models.find((m) => m.slug === 'ms-standard')!;
    /** The values listed in one table row, found by its row header. */
    const rowValues = (table: string, label: number) => {
      const match = table.match(new RegExp(`<th scope="row"[^>]*>${label}</th><td[^>]*>(.*?)</td>`));
      expect(match, `row ${label}`).not.toBeNull();
      return [...match![1].matchAll(/<li[^>]*>([^<]+)<\/li>/g)].map((m) => m[1]);
    };
    // The width table precedes the height table on the page.
    const split = html.indexOf(`${t(HM['HM-025'], locale)}, `);
    expect(split).toBeGreaterThan(0);
    const widthTable = html.slice(0, split);
    const heightTable = html.slice(split);

    for (const width of model.widths) {
      expect(rowValues(widthTable, width).map(Number)).toEqual(getAllowedDepthsForWidth(width));
    }
    // 700 mm depth is not offered for a 700 mm section.
    expect(rowValues(widthTable, 700)).not.toContain('700');

    for (const height of model.heights) {
      expect(rowValues(heightTable, height)).toEqual([`${model.minShelves}–${getMaxShelvesForHeight(height)}`]);
    }
  });

  it('keeps the approved delivery wording and never names a hidden model', async () => {
    const html = await modelHtml(locale);
    expect(html).toContain(t(PR['PR-025'], locale));
    for (const model of hiddenModels()) {
      expect(html).not.toContain(`/catalog/${model.slug}`);
      expect(html).not.toContain(model.name[locale]);
    }
  });
});
