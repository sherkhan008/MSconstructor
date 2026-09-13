import { test, expect } from '@playwright/test';

/**
 * Catalog routes render per request from the runtime catalog (nothing is
 * prerendered during `next build` — see getCatalog() in
 * src/lib/data/repository.ts). These checks read the raw HTTP response, not
 * the hydrated DOM, so they prove the content and SEO tags are server-rendered
 * HTML a crawler receives — not a client-only shell.
 */

test('/catalog/ms-standard is server-rendered, indexable HTML with a canonical URL', async ({ request }) => {
  const response = await request.get('/catalog/ms-standard');
  expect(response.status()).toBe(200);

  const html = await response.text();
  expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
  expect(html).toMatch(/<link rel="canonical" href="[^"]*\/catalog\/ms-standard"/);
  expect(html).toMatch(/<meta name="robots" content="index, follow"/);
  expect(html).toContain('application/ld+json');
  expect(html).toContain('href="/configurator?model=ms-standard"');
});

test('an unknown catalog model returns HTTP 404 and is not indexable', async ({ request }) => {
  const response = await request.get('/catalog/no-such-model-e2e');
  expect(response.status()).toBe(404);
  expect(await response.text()).toMatch(/<meta name="robots" content="noindex/);
});

// Dynamic routes stream resolved metadata to JS-capable clients; crawlers that
// only read HTML (Next's htmlLimitedBots list, which includes Yandex and Bing)
// must get it inside <head>.
test('an HTML-only crawler gets the model title, canonical and robots tags inside <head>', async ({ request }) => {
  const response = await request.get('/catalog/ms-standard', {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)' },
  });
  expect(response.status()).toBe(200);

  const head = (await response.text()).split('</head>')[0];
  expect(head).toMatch(/<title>[^<]+<\/title>/);
  expect(head).toMatch(/<link rel="canonical" href="[^"]*\/catalog\/ms-standard"/);
  expect(head).toMatch(/<meta name="robots" content="index, follow"/);
});

test('/catalog is server-rendered', async ({ request }) => {
  const response = await request.get('/catalog');
  expect(response.status()).toBe(200);
  expect(await response.text()).toMatch(/<h1[^>]*>Каталог стеллажей MS<\/h1>/);
});

test('the sitemap is generated at request time and lists catalog model pages', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  expect(await response.text()).toMatch(/<loc>[^<]*\/catalog\/ms-standard<\/loc>/);
});
