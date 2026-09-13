import { beforeAll, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { getCatalog, resetCatalogCache, type Catalog } from '@/lib/data/repository';
import { FilterForm } from '@/components/catalog/FilterForm';
import CatalogPage from '@/app/catalog/page';
import type { PublicProductModel } from '@/lib/types/domain';

/**
 * Regression test for a real bug: src/app/catalog/page.tsx used to pass the
 * raw internal `catalog.models` (markupPercent/markupFixed included) straight
 * into FilterForm, a Client Component — so those fields were serialized into
 * the page's RSC/HTML payload even though src/lib/data/public-catalog.ts
 * already had a public-safe projection that nobody called at that spot.
 *
 * tests/integration/public-price-leak.test.ts already proves toPublicCatalog()
 * itself strips these fields; this test instead inspects the exact `props`
 * object Next.js serializes across the server/client boundary — a Server
 * Component's returned React element tree already carries the literal props
 * object that would cross into the Client Component, with no rendering
 * needed. (Actually rendering with plain react-dom/server would NOT catch
 * this: it produces normal DOM output and never exercises Next's Flight
 * serialization, so it passes regardless of whether the props were
 * sanitized.) Walking the element tree to the real FilterForm reference is
 * what pins the boundary down precisely.
 */

const FORBIDDEN_KEYS = ['markupPercent', 'markupFixed', 'purchasePrice', 'unitCost', 'supplierRef'];

function collectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      collectKeys(child, found);
    }
  }
  return found;
}

/** Depth-first search of a React element tree for the first element of `type`. */
function findElement(node: unknown, type: unknown): ReactElement | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return undefined;
  }
  const element = node as ReactElement<{ children?: unknown }>;
  if (!('type' in element)) return undefined;
  if (element.type === type) return element;
  return findElement(element.props?.children, type);
}

let catalog: Catalog;

beforeAll(async () => {
  resetCatalogCache();
  catalog = await getCatalog();
});

describe('/catalog: props crossing into the FilterForm Client Component', () => {
  it('sanity check: the source catalog actually has non-zero markup, so a passing test is meaningful', () => {
    const withMarkup = catalog.models.filter((m) => m.markupPercent > 0 || m.markupFixed > 0);
    expect(withMarkup.length).toBeGreaterThan(0);
  });

  it('never receives markupPercent/markupFixed or any other forbidden key', async () => {
    const element = await CatalogPage({ searchParams: Promise.resolve({}) });
    const filterFormElement = findElement(element, FilterForm);
    expect(filterFormElement, 'FilterForm was not found in the page tree').toBeDefined();

    const props = filterFormElement!.props as { models: PublicProductModel[] };
    const keys = collectKeys(props);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden), `FilterForm props leak "${forbidden}"`).toBe(false);
    }

    // And the models it *did* receive are still usable for filtering — the
    // fix must not have dropped what the UI actually needs.
    expect(props.models.length).toBeGreaterThan(0);
    expect(props.models.every((m) => typeof m.slug === 'string' && typeof m.name?.ru === 'string')).toBe(true);
  });

  it('still receives the correct models with a filter query param applied', async () => {
    const element = await CatalogPage({ searchParams: Promise.resolve({ model: 'ms-standard' }) });
    const filterFormElement = findElement(element, FilterForm);
    const props = filterFormElement!.props as Record<string, unknown>;
    const keys = collectKeys(props);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });
});
