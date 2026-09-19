import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import HomePage from '@/app/page';
import CatalogPage from '@/app/catalog/page';
import ModelPage from '@/app/catalog/[model]/page';
import ConfiguratorPage from '@/app/configurator/page';

describe('public production visuals', () => {
  it.each([
    ['homepage', () => HomePage()],
    ['catalog', () => CatalogPage({ searchParams: Promise.resolve({}) })],
    ['model', () => ModelPage({ params: Promise.resolve({ model: 'ms-standard' }) })],
  ] as const)('%s renders real racks and no embedded sample image', async (_, render) => {
    const html = renderToStaticMarkup(await render());
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/SAMPLE IMAGE/i);
    // Text checks alone miss labels embedded inside external SVGs.
    for (const match of html.matchAll(/<img[^>]+src="(\/[^"?]+\.svg)"/g)) {
      expect(readFileSync(resolve('public', match[1].slice(1)), 'utf8')).not.toMatch(/SAMPLE IMAGE/i);
    }
  });

  it('catalog drawings stay server-rendered through the visual slot', () => {
    const source = readFileSync(resolve('src/components/catalog/CatalogRackPreview.tsx'), 'utf8');
    expect(source).not.toContain('use client');
    expect(source).not.toContain('useDimensionDrag');
    expect(source).toContain('computeRenderDepthVec');
  });

  it('the public fallback and social SVG is a real four-shelf rack', () => {
    const svg = readFileSync(resolve('public/images/models/ms-standard.svg'), 'utf8');
    expect(svg).not.toMatch(/SAMPLE IMAGE/i);
    expect(svg.match(/data-shelf=/g)).toHaveLength(4);
    expect(svg).toContain('2000×1000×300');
  });
});

describe('configurator launch visibility', () => {
  it.each(['ms-strong', 'archive-ms', 'unknown'])('rejects %s before rendering a configurator', async model => {
    await expect(ConfiguratorPage({ searchParams: Promise.resolve({ model }) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });
  it.each([{}, { model: 'ms-standard' }])('accepts the public entry %j', async params => {
    expect(await ConfiguratorPage({ searchParams: Promise.resolve(params) })).toBeDefined();
  });
});
