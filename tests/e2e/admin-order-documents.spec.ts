import { test, expect, request as playwrightRequest, type BrowserContext } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import {
  createOrderFixtures,
  createPrismaClient,
  removeOrderFixtures,
  sessionCookieFor,
  type FixtureRole,
  type OrderFixtures,
} from './helpers/admin-order-fixtures';

/**
 * "Документы" on /admin/orders/[id] — commercial proposal and invoice PDFs.
 *
 * Runs against the real app and database with its own disposable orders
 * (prefix E2EDOC…, removed afterwards), never a real customer's order. Both
 * Playwright projects run it: desktop Chrome and Pixel 7 (412 px wide).
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
test.skip(!hasDatabase, 'requires a real PostgreSQL DATABASE_URL — see docs/production-database.md');
test.describe.configure({ mode: 'serial' });

let prisma: PrismaClient;
let fixtures: OrderFixtures;

function documentsPrefix(projectName: string): string {
  return `E2EDOC${projectName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`;
}

test.beforeAll(async ({}, testInfo) => {
  prisma = createPrismaClient();
  fixtures = await createOrderFixtures(prisma, documentsPrefix(testInfo.project.name));
});

test.afterAll(async () => {
  if (!prisma) return;
  await removeOrderFixtures(prisma, fixtures.prefix);
  const leftovers = await prisma.order.count({ where: { orderNumber: { startsWith: fixtures.prefix } } });
  expect(leftovers).toBe(0);
  await prisma.$disconnect();
});

async function signIn(context: BrowserContext, role: FixtureRole, baseURL: string) {
  await context.clearCookies();
  await context.addCookies([await sessionCookieFor(fixtures.users[role], baseURL)]);
}

async function pdfText(bytes: Buffer): Promise<{ flat: string; numPages: number }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const content = await (await pdf.getPage(i)).getTextContent();
    text += content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : '')).join('');
  }
  const numPages = pdf.numPages;
  await task.destroy();
  return { flat: text.replace(/\s+/g, ' '), numPages };
}

test('the documents section offers both PDFs without breaking the layout', async ({ page, context, baseURL }) => {
  await signIn(context, 'ADMIN', baseURL!);
  await page.goto(`/admin/orders/${fixtures.legacy.id}`);

  await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
  const list = page.getByTestId('order-documents');
  await expect(list.locator('[data-document-kind]')).toHaveCount(2);

  const proposal = list.locator('[data-document-kind="commercial-proposal"]');
  await expect(proposal).toContainText('Коммерческое предложение');
  await expect(proposal).toContainText(`KP-${fixtures.legacy.orderNumber}`);
  const open = proposal.getByRole('link', { name: 'Открыть PDF: Коммерческое предложение' });
  const download = proposal.getByRole('link', { name: 'Скачать PDF: Коммерческое предложение' });
  await expect(open).toBeVisible();
  await expect(download).toBeVisible();
  await expect(open).toHaveAttribute('target', '_blank');

  for (const link of [open, download]) {
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  const invoice = list.locator('[data-document-kind="invoice"]');
  await expect(invoice).toContainText('Счёт на оплату');
  await expect(invoice).toContainText(`INV-${fixtures.legacy.orderNumber}`);

  // No page-level horizontal scrolling at either viewport.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole('heading', { name: 'Документы' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('order-documents-section.png'), fullPage: false });
});

test('a real commercial proposal PDF is generated from the saved order, repeatably and without changing it', async ({ page, context, baseURL }, testInfo) => {
  await signIn(context, 'ADMIN', baseURL!);
  const before = await prisma.order.findUniqueOrThrow({ where: { id: fixtures.legacy.id }, include: { items: true } });

  await page.goto(`/admin/orders/${fixtures.legacy.id}`);
  const href = await page
    .getByTestId('order-documents')
    .getByRole('link', { name: 'Открыть PDF: Коммерческое предложение' })
    .getAttribute('href');

  const first = await page.request.get(href!);
  expect(first.status()).toBe(200);
  expect(first.headers()['content-type']).toBe('application/pdf');
  expect(first.headers()['cache-control']).toContain('no-store');
  const bytes = await first.body();
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await testInfo.attach('commercial-proposal.pdf', { body: bytes, contentType: 'application/pdf' });

  const { flat } = await pdfText(bytes);
  expect(flat).toContain(`№ KP-${fixtures.legacy.orderNumber}`);
  expect(flat).toContain(fixtures.legacy.companyName);
  expect(flat).toContain(`БИН ${fixtures.legacy.binIin}`);
  // Fixture totals: net 844 828, VAT 135 172, total 980 000.
  expect(flat).toContain('Итого без НДС 844 828,00 ₸');
  expect(flat).toContain('НДС 135 172,00 ₸');
  expect(flat).toContain('Итого с НДС 980 000,00 ₸');
  expect(flat).not.toContain('MS-UPR-2000');

  const downloadResponse = await page.request.get(`${href}?download=1`);
  expect(downloadResponse.headers()['content-disposition']).toBe(`attachment; filename="KP-${fixtures.legacy.orderNumber}.pdf"`);
  expect((await downloadResponse.body()).equals(bytes)).toBe(true);

  const after = await prisma.order.findUniqueOrThrow({ where: { id: fixtures.legacy.id }, include: { items: true } });
  expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  expect(after.grandTotal.toString()).toBe(before.grandTotal.toString());
  expect(after.vatTotal.toString()).toBe(before.vatTotal.toString());
  expect(after.items.map((i) => [i.unitNetPrice.toString(), i.totalNetPrice.toString()])).toEqual(
    before.items.map((i) => [i.unitNetPrice.toString(), i.totalNetPrice.toString()]),
  );
});

test('the invoice is either generated or blocked with the exact missing seller settings — never faked', async ({ page, context, baseURL }) => {
  await signIn(context, 'ADMIN', baseURL!);
  await page.goto(`/admin/orders/${fixtures.unassigned.id}`);
  const invoice = page.getByTestId('order-documents').locator('[data-document-kind="invoice"]');
  const api = `/api/admin/orders/${fixtures.unassigned.id}/documents/invoice`;
  const response = await page.request.get(api);

  if ((await invoice.getByTestId('document-blockers').count()) > 0) {
    await expect(invoice.getByRole('link')).toHaveCount(0);
    await expect(invoice.getByTestId('document-blockers')).toContainText('SELLER_');
    expect(response.status()).toBe(422);
    const json = await response.json();
    expect((json.details as string[]).some((d) => d.includes('SELLER_'))).toBe(true);
  } else {
    expect(response.status()).toBe(200);
    const { flat } = await pdfText(await response.body());
    expect(flat).toContain(`№ INV-${fixtures.unassigned.orderNumber}`);
    expect(flat).toContain('Всего к оплате 145 000,00 ₸');
  }
});

test('document endpoints are admin-only', async ({ page, context, baseURL }) => {
  const path = `/api/admin/orders/${fixtures.legacy.id}/documents/commercial-proposal`;

  const anonymous = await playwrightRequest.newContext({ baseURL });
  expect((await anonymous.get(path)).status()).toBe(401);
  await anonymous.dispose();

  await signIn(context, 'CONTENT_MANAGER', baseURL!);
  expect((await page.request.get(path)).status()).toBe(403);
  await page.goto(`/admin/orders/${fixtures.legacy.id}`);
  await expect(page.getByText('Недостаточно прав для формирования документов.')).toBeVisible();

  await signIn(context, 'MANAGER', baseURL!);
  expect((await page.request.get(path)).status()).toBe(200);
  expect((await page.request.get('/api/admin/orders/cdoesnotexist0000000000000/documents/invoice')).status()).toBe(404);
  expect((await page.request.get(`/api/admin/orders/${fixtures.legacy.id}/documents/receipt`)).status()).toBe(404);
});
