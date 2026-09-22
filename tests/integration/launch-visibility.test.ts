import { beforeAll, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { PUBLIC_MODEL_SLUGS, isModelSlugPubliclyVisible } from '@/lib/config/launch-visibility';
import HomePage from '@/app/[locale]/page';
import CatalogPage from '@/app/[locale]/catalog/page';
import ModelPage, { generateMetadata as generateModelMetadata } from '@/app/[locale]/catalog/[model]/page';
import sitemap from '@/app/sitemap';
import { LOCALES, localizePath, type Locale } from '@/lib/i18n/locales';
import { localeProps, renderInLocale } from './helpers/public-page';

/**
 * Temporary public-launch allowlist (src/lib/config/launch-visibility.ts):
 * only 'ms-standard' is publicly visible for the current launch. ms-strong
 * and archive-ms must disappear from every public surface while remaining
 * fully intact in the catalog data (pricing/BOM/admin are untouched).
 */

const HIDDEN_SLUGS = ['ms-strong', 'archive-ms'];

let catalog: Catalog;

beforeAll(async () => {
  resetCatalogCache();
  catalog = await getCatalog();
});

function params(model: string, locale: Locale) {
  return localeProps(locale, { model });
}

/** A catalog link as rendered on a page in `locale` (/catalog/x or /ru/catalog/x). */
const modelHref = (slug: string, locale: Locale) => `href="${localizePath(`/catalog/${slug}`, locale)}"`;

describe('launch-visibility allowlist', () => {
  it('only allows ms-standard for now', () => {
    expect(PUBLIC_MODEL_SLUGS).toEqual(['ms-standard']);
    expect(isModelSlugPubliclyVisible('ms-standard')).toBe(true);
    for (const slug of HIDDEN_SLUGS) expect(isModelSlugPubliclyVisible(slug)).toBe(false);
  });
});

describe('internal catalog data is untouched', () => {
  it('ms-strong and archive-ms still exist in the catalog with their data intact', () => {
    for (const slug of HIDDEN_SLUGS) {
      const model = catalog.models.find((m) => m.slug === slug);
      expect(model, `${slug} should still exist internally`).toBeDefined();
      expect(model!.active).toBe(true);
    }
    // Products tied to hidden models remain in the catalog too.
    expect(catalog.products.some((p) => p.modelSlug === 'ms-strong')).toBe(true);
    expect(catalog.products.some((p) => p.modelSlug === 'archive-ms')).toBe(true);
  });
});

describe.each(LOCALES)('homepage (%s)', (locale) => {
  it('renders MS Standard but not MS Strong or Archive MS', async () => {
    const html = await renderInLocale((await HomePage(localeProps(locale))) as ReactElement, locale);
    expect(html).toContain(modelHref('ms-standard', locale));
    for (const slug of HIDDEN_SLUGS) {
      expect(html).not.toContain(modelHref(slug, locale));
      expect(html).not.toContain(`/catalog/${slug}`);
    }
  });

  it('no longer renders the placeholder delivery/assembly gallery', async () => {
    const html = await renderInLocale((await HomePage(localeProps(locale))) as ReactElement, locale);
    expect(html).not.toContain('/images/gallery/warehouse-1.svg');
    expect(html).not.toContain('/images/gallery/warehouse-2.svg');
    expect(html).not.toContain('/images/gallery/archive-1.svg');
    expect(html).not.toContain('/images/models/ms-strong.svg');
  });

  it('still renders the real delivery/payment content', async () => {
    const html = await renderInLocale((await HomePage(localeProps(locale))) as ReactElement, locale);
    expect(html).toContain(locale === 'ru' ? 'Способы получения' : 'Тауарды алу тәсілдері');
    expect(html).toContain(locale === 'ru' ? 'Способы оплаты' : 'Төлем тәсілдері');
  });

  it('never names a hidden model, even though a translation of it exists', async () => {
    const html = await renderInLocale((await HomePage(localeProps(locale))) as ReactElement, locale);
    for (const slug of HIDDEN_SLUGS) {
      const model = catalog.models.find((m) => m.slug === slug)!;
      expect(model.name.kk, `${slug} has a Kazakh name`).not.toBe('');
      expect(html).not.toContain(model.name[locale]);
    }
  });
});

describe.each(LOCALES)('/catalog listing (%s)', (locale) => {
  it('does not list products belonging to hidden models', async () => {
    const element = await CatalogPage(localeProps(locale));
    const html = await renderInLocale(element as ReactElement, locale);
    for (const slug of HIDDEN_SLUGS) {
      expect(html).not.toContain(`/catalog/${slug}`);
    }
  });

  it('filtering by a hidden model slug returns no products (not an error)', async () => {
    const element = await CatalogPage(localeProps(locale, {}, { model: 'ms-strong' }));
    const html = await renderInLocale(element as ReactElement, locale);
    expect(html).toContain(locale === 'ru' ? 'ничего не найдено' : 'ештеңе табылмады');
  });
});

describe.each(LOCALES)('/catalog/[model] direct route (%s)', (locale) => {
  it('MS Standard remains accessible', async () => {
    const html = await renderInLocale((await ModelPage(params('ms-standard', locale))) as ReactElement, locale);
    const model = catalog.models.find((m) => m.slug === 'ms-standard')!;
    expect(html).toContain(model.name[locale]);

    const metadata = await generateModelMetadata(params('ms-standard', locale));
    expect(metadata.robots).toMatchObject({ index: true });
  });

  it.each(HIDDEN_SLUGS)('a direct route to hidden model "%s" is a 404, not a placeholder page', async (slug) => {
    await expect(ModelPage(params(slug, locale))).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });

    const metadata = await generateModelMetadata(params(slug, locale));
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it('does not link to hidden models in "Другие модели"', async () => {
    const html = await renderInLocale((await ModelPage(params('ms-standard', locale))) as ReactElement, locale);
    for (const slug of HIDDEN_SLUGS) {
      expect(html).not.toContain(`/catalog/${slug}`);
    }
  });
});

describe('sitemap', () => {
  it('does not expose hidden model routes, and keeps ms-standard', async () => {
    const routes = await sitemap();
    const urls = routes.map((r) => r.url);
    expect(urls.some((u) => u.endsWith('/catalog/ms-standard'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/ru/catalog/ms-standard'))).toBe(true);
    for (const slug of HIDDEN_SLUGS) {
      expect(urls.some((u) => u.includes(`/catalog/${slug}`))).toBe(false);
    }
  });
});
