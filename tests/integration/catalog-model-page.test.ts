import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInLocale } from './helpers/public-page';
import { isValidElement, type ReactElement } from 'react';
import type { Catalog } from '@/lib/data/repository';

/**
 * /catalog/[model] is rendered per request from the runtime catalog, not
 * prerendered from a database snapshot taken during `next build` (the
 * production image is built with no database — see Dockerfile). These tests
 * run the page through the database-backed catalog path (a PostgreSQL
 * DATABASE_URL), the database itself stood in for by a mocked
 * buildDbCatalog() whose rows the test can change after the page module has
 * been loaded — i.e. after the "image" was built. NODE_ENV stays "test":
 * the production-only DATABASE_URL guard is covered by
 * production-database.test.ts, and a production NODE_ENV would swap out
 * React's JSX dev runtime this test file is compiled against.
 */

const ORIGINAL_ENV = { ...process.env };
const FORBIDDEN_KEYS = ['markupPercent', 'markupFixed', 'purchasePrice', 'unitCost', 'supplierRef'];

let dbRows: Catalog;

async function sampleCatalog(): Promise<Catalog> {
  // The in-memory sample catalog has exactly the shape the database-backed
  // repository returns; it only serves as realistic "database rows" here.
  vi.stubEnv('NODE_ENV', 'test');
  delete process.env.DATABASE_URL;
  delete process.env.NEXT_PHASE;
  vi.resetModules();
  const { getCatalog } = await import('@/lib/data/repository');
  return structuredClone(await getCatalog());
}

async function loadPage() {
  vi.stubEnv('NODE_ENV', 'test');
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
  delete process.env.NEXT_PHASE;
  vi.resetModules();
  vi.doMock('@/lib/data/db-repository', () => ({ buildDbCatalog: vi.fn(async () => structuredClone(dbRows)) }));
  const pageModule = await import('@/app/[locale]/catalog/[model]/page');
  return { pageModule };
}

/** Russian model page — the content assertions below are written in Russian. */
function params(model: string) {
  return { params: Promise.resolve({ locale: 'ru', model }) };
}

/** Every object key reachable from the page's element tree, descending into
 * each React element's props only (never React's own bookkeeping fields). */
function collectKeys(value: unknown, found = new Set<string>(), seen = new WeakSet<object>()): Set<string> {
  if (!value || typeof value !== 'object' || seen.has(value)) return found;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found, seen);
  } else if (isValidElement(value)) {
    collectKeys(value.props, found, seen);
  } else {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      collectKeys(child, found, seen);
    }
  }
  return found;
}

beforeEach(async () => {
  dbRows = await sampleCatalog();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.resetModules();
  vi.doUnmock('@/lib/data/db-repository');
  vi.doUnmock('@/lib/config/launch-visibility');
});

describe('/catalog/[model] rendering strategy', () => {
  it('renders at request time and has no build-time static params that would need a database', async () => {
    const { pageModule } = await loadPage();
    expect(pageModule.dynamic).toBe('force-dynamic');
    expect('generateStaticParams' in pageModule).toBe(false);
  });
});

describe('/catalog/[model] against the runtime catalog', () => {
  it('renders a known model server-side with its content and indexable metadata', async () => {
    const { pageModule } = await loadPage();
    const model = dbRows.models.find((m) => m.slug === 'ms-standard')!;

    const html = await renderInLocale((await pageModule.default(params('ms-standard'))) as ReactElement, 'ru');
    expect(html).toMatch(new RegExp(`<h1[^>]*>${model.name.ru}</h1>`));
    expect(html).toContain('application/ld+json');

    const metadata = await pageModule.generateMetadata(params('ms-standard'));
    expect(metadata.alternates?.canonical).toMatch(/\/catalog\/ms-standard$/);
    expect(metadata.robots).toMatchObject({ index: true });
  });

  it('an unknown model is a 404 and is not indexable', async () => {
    const { pageModule } = await loadPage();

    await expect(pageModule.default(params('no-such-model'))).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
    const metadata = await pageModule.generateMetadata(params('no-such-model'));
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it('a model added to the database after the page was loaded renders once the catalog cache refreshes — no rebuild', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // This test is about cache-refresh timing, not the temporary launch
    // allowlist (src/lib/config/launch-visibility.ts) — bypass it so an
    // arbitrary new slug isn't blocked as "not launched yet".
    vi.doMock('@/lib/config/launch-visibility', () => ({ isModelSlugPubliclyVisible: () => true }));
    const { pageModule } = await loadPage();
    const { CATALOG_CACHE_TTL_MS } = await import('@/lib/data/repository');

    await expect(pageModule.default(params('ms-new-model'))).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });

    const template = dbRows.models.find((m) => m.slug === 'ms-standard')!;
    dbRows.models.push({
      ...structuredClone(template),
      id: 'model-ms-new-model',
      slug: 'ms-new-model',
      name: { ru: 'MS Новая модель', kk: 'MS Новая модель' },
    });
    vi.setSystemTime(Date.now() + CATALOG_CACHE_TTL_MS + 1);

    const html = await renderInLocale((await pageModule.default(params('ms-new-model'))) as ReactElement, 'ru');
    expect(html).toContain('MS Новая модель');
  });

  it('never passes internal commercial fields into the rendered page', async () => {
    const { pageModule } = await loadPage();
    // Sanity check: the source rows really carry the internal fields.
    expect(dbRows.models.some((m) => m.markupPercent > 0 || m.markupFixed > 0)).toBe(true);

    const element = await pageModule.default(params('ms-standard'));
    const keys = collectKeys(element);
    // The walk really reached the product data handed to ProductCard.
    expect(keys.has('modelSlug')).toBe(true);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden), `page props leak "${forbidden}"`).toBe(false);
    }
    const html = await renderInLocale(element as ReactElement, 'ru');
    for (const forbidden of FORBIDDEN_KEYS) expect(html).not.toContain(forbidden);
  });
});
