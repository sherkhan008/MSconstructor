import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { PUBLIC_MODEL_SLUGS, isModelSlugPubliclyVisible } from '@/lib/config/launch-visibility';
import HomePage from '@/app/page';
import CatalogPage from '@/app/catalog/page';
import ModelPage, { generateMetadata as generateModelMetadata } from '@/app/catalog/[model]/page';
import sitemap from '@/app/sitemap';

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

function params(model: string) {
  return { params: Promise.resolve({ model }) };
}

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

describe('homepage', () => {
  it('renders MS Standard but not MS Strong or Archive MS', async () => {
    const html = renderToStaticMarkup((await HomePage()) as ReactElement);
    expect(html).toContain('href="/catalog/ms-standard"');
    for (const slug of HIDDEN_SLUGS) {
      expect(html).not.toContain(`href="/catalog/${slug}"`);
    }
  });

  it('no longer renders the placeholder delivery/assembly gallery', async () => {
    const html = renderToStaticMarkup((await HomePage()) as ReactElement);
    expect(html).not.toContain('/images/gallery/warehouse-1.svg');
    expect(html).not.toContain('/images/gallery/warehouse-2.svg');
    expect(html).not.toContain('/images/gallery/archive-1.svg');
    expect(html).not.toContain('/images/models/ms-strong.svg');
  });

  it('still renders the real delivery/payment content', async () => {
    const html = renderToStaticMarkup((await HomePage()) as ReactElement);
    expect(html).toContain('Способы получения');
    expect(html).toContain('Способы оплаты');
  });
});

describe('/catalog listing', () => {
  it('does not list products belonging to hidden models', async () => {
    const element = await CatalogPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element as ReactElement);
    for (const slug of HIDDEN_SLUGS) {
      expect(html).not.toContain(`href="/catalog/${slug}"`);
    }
  });

  it('filtering by a hidden model slug returns no products (not an error)', async () => {
    const element = await CatalogPage({ searchParams: Promise.resolve({ model: 'ms-strong' }) });
    const html = renderToStaticMarkup(element as ReactElement);
    expect(html).toContain('ничего не найдено');
  });
});

describe('/catalog/[model] direct route', () => {
  it('MS Standard remains accessible', async () => {
    const html = renderToStaticMarkup((await ModelPage(params('ms-standard'))) as ReactElement);
    const model = catalog.models.find((m) => m.slug === 'ms-standard')!;
    expect(html).toContain(model.name.ru);

    const metadata = await generateModelMetadata(params('ms-standard'));
    expect(metadata.robots).toMatchObject({ index: true });
  });

  it.each(HIDDEN_SLUGS)('a direct route to hidden model "%s" is a 404, not a placeholder page', async (slug) => {
    await expect(ModelPage(params(slug))).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });

    const metadata = await generateModelMetadata(params(slug));
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it('does not link to hidden models in "Другие модели"', async () => {
    const html = renderToStaticMarkup((await ModelPage(params('ms-standard'))) as ReactElement);
    for (const slug of HIDDEN_SLUGS) {
      expect(html).not.toContain(`href="/catalog/${slug}"`);
    }
  });
});

describe('sitemap', () => {
  it('does not expose hidden model routes, and keeps ms-standard', async () => {
    const routes = await sitemap();
    const urls = routes.map((r) => r.url);
    expect(urls.some((u) => u.endsWith('/catalog/ms-standard'))).toBe(true);
    for (const slug of HIDDEN_SLUGS) {
      expect(urls.some((u) => u.endsWith(`/catalog/${slug}`))).toBe(false);
    }
  });
});
