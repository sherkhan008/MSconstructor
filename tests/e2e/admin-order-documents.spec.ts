import { test, expect } from './helpers/test';
import { request as playwrightRequest, type BrowserContext, type Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import {
  createOrder,
  createOrderFixtures,
  createPrismaClient,
  removeOrderFixtures,
  sessionCookieFor,
  type FixtureRole,
  type OrderFixtures,
} from './helpers/admin-order-fixtures';
import {
  checkoutFixturePrefix,
  checkoutIdentity,
  removeCheckoutFixtures,
  simulatedClientIp,
} from './helpers/checkout-order-fixtures';
import { clickWhenHydrated } from './helpers/hydration';

/**
 * "Документы" on /admin/orders/[id] — commercial proposal and invoice PDFs.
 *
 * Two routes, two HTTP methods: POST …/documents/:kind/issue freezes a
 * document's number, date and seller details exactly once; GET
 * …/documents/:kind only ever renders an already-issued document and never
 * creates or mutates anything — a document link, a prefetch, a bookmark
 * revisited months later must never have a side effect.
 *
 * Runs against the real app and database with its own disposable orders
 * (prefix E2EDOC…, removed afterwards — issued OrderDocument rows included),
 * never a real customer's order. Both Playwright projects run it: desktop
 * Chrome and Pixel 7 (412 px wide).
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
test.skip(!hasDatabase, 'requires a real PostgreSQL DATABASE_URL — see docs/production-database.md');
test.describe.configure({ mode: 'serial' });

let prisma: PrismaClient;
let fixtures: OrderFixtures;
let legacyOrder: { id: string; orderNumber: string };
let raceOrder: { id: string; orderNumber: string };
let checkoutPrefix: string;

/** One prefix per (project, repetition) — see checkoutFixturePrefix for why
 * `repeatEachIndex` goes in front and is followed by a literal `X`. */
function documentsPrefix(projectName: string, repeatEachIndex: number): string {
  return `E2EDOC${repeatEachIndex}X${projectName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`;
}

test.beforeAll(async ({}, testInfo) => {
  prisma = createPrismaClient();
  const prefix = documentsPrefix(testInfo.project.name, testInfo.repeatEachIndex);
  checkoutPrefix = checkoutFixturePrefix('DOCCHK', testInfo.project.name, testInfo.repeatEachIndex);
  await removeCheckoutFixtures(prisma, checkoutPrefix);
  fixtures = await createOrderFixtures(prisma, prefix);
  const common = { prefix, status: 'NEW' as const, customerType: 'INDIVIDUAL' as const, createdAt: new Date(), grandTotal: 116_000 };
  legacyOrder = await createOrder(prisma, { ...common, index: 9, fullName: `${prefix} До снимков`, documentSnapshots: false });
  raceOrder = await createOrder(prisma, { ...common, index: 10, fullName: `${prefix} Гонка` });
});

test.afterAll(async () => {
  if (!prisma) return;
  await removeOrderFixtures(prisma, fixtures.prefix);
  await removeCheckoutFixtures(prisma, checkoutPrefix);
  // Issued documents were removed with their orders (ON DELETE RESTRICT would
  // otherwise have made the order deletion fail).
  expect(await prisma.order.count({ where: { orderNumber: { startsWith: fixtures.prefix } } })).toBe(0);
  expect(await prisma.orderDocument.count({ where: { documentNumber: { contains: fixtures.prefix } } })).toBe(0);
  expect(await prisma.customer.count({ where: { fullName: { startsWith: checkoutPrefix } } })).toBe(0);
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

function documentPath(orderId: string, kind: 'commercial-proposal' | 'invoice') {
  return `/api/admin/orders/${orderId}/documents/${kind}`;
}

function issuePath(orderId: string, kind: 'commercial-proposal' | 'invoice') {
  return `${documentPath(orderId, kind)}/issue`;
}

async function orderState(orderId: string) {
  const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  return JSON.stringify({
    updatedAt: row.updatedAt.toISOString(),
    totals: [row.netTotal, row.vatTotal, row.discountTotal, row.grandTotal].map(String),
    buyerSnapshot: row.buyerSnapshot,
    customerId: row.customerId,
    items: row.items.map((i) => [i.unitNetPrice.toString(), i.totalNetPrice.toString(), i.configuration, i.bomSnapshot, i.documentSnapshot]),
  });
}

test('a ready, unissued document offers "Сформировать…" — no Open/Download until issued', async ({ page, context, baseURL }) => {
  await signIn(context, 'ADMIN', baseURL!);
  expect(await prisma.orderDocument.count({ where: { orderId: fixtures.legacy.id } })).toBe(0);
  await page.goto(`/admin/orders/${fixtures.legacy.id}`);

  await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
  const list = page.getByTestId('order-documents');
  await expect(list.locator('[data-document-kind]')).toHaveCount(2);

  const proposal = list.locator('[data-document-kind="commercial-proposal"]');
  await expect(proposal).toContainText('Коммерческое предложение');
  await expect(proposal).toContainText(`KP-${fixtures.legacy.orderNumber}`);
  await expect(proposal).toContainText('будут зафиксированы при формировании документа');
  await expect(proposal.getByRole('link')).toHaveCount(0);
  const issueButton = proposal.getByTestId('issue-document');
  await expect(issueButton).toBeVisible();
  await expect(issueButton).toHaveText('Сформировать коммерческое предложение');
  const box = await issueButton.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // No page-level horizontal scrolling at either viewport.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole('heading', { name: 'Документы' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('order-documents-section.png'), fullPage: false });
});

test('GET before issuance renders nothing and writes nothing', async ({ page, context, baseURL }) => {
  await signIn(context, 'ADMIN', baseURL!);
  const before = await orderState(fixtures.legacy.id);
  expect(await prisma.orderDocument.count({ where: { orderId: fixtures.legacy.id } })).toBe(0);

  const response = await page.request.get(documentPath(fixtures.legacy.id, 'commercial-proposal'));
  expect(response.status()).toBe(409);
  const json = await response.json();
  expect(json.message).toContain('не выставлен');

  expect(await prisma.orderDocument.count({ where: { orderId: fixtures.legacy.id } })).toBe(0);
  expect(await orderState(fixtures.legacy.id)).toBe(before);
});

test('clicking "Сформировать" issues the proposal once; Order.updatedAt is unaffected; GET renders it repeatably without writing again', async ({ page, context, baseURL }, testInfo) => {
  await signIn(context, 'ADMIN', baseURL!);
  const before = await orderState(fixtures.legacy.id);

  await page.goto(`/admin/orders/${fixtures.legacy.id}`);
  const proposal = page.getByTestId('order-documents').locator('[data-document-kind="commercial-proposal"]');
  // OrderDocuments renders this button `disabled={issuing}` — enabled in the
  // server HTML with a JavaScript-only onClick (see helpers/hydration.ts).
  await clickWhenHydrated(proposal.getByTestId('issue-document'));

  // The row switches to Open/Download once router.refresh() picks up the
  // freshly-issued OrderDocument from the server component.
  const open = proposal.getByRole('link', { name: 'Открыть PDF: Коммерческое предложение' });
  const download = proposal.getByRole('link', { name: 'Скачать PDF: Коммерческое предложение' });
  await expect(open).toBeVisible();
  await expect(download).toBeVisible();
  await expect(proposal.getByTestId('issue-document')).toHaveCount(0);
  await expect(open).toHaveAttribute('target', '_blank');

  // Exactly one issuance row, with the persisted number, date and issuer.
  const issued = await prisma.orderDocument.findMany({ where: { orderId: fixtures.legacy.id } });
  expect(issued).toHaveLength(1);
  expect(issued[0]).toMatchObject({
    kind: 'COMMERCIAL_PROPOSAL',
    documentNumber: `KP-${fixtures.legacy.orderNumber}`,
    issuedById: fixtures.users.ADMIN.id,
    issuedByName: fixtures.users.ADMIN.name,
  });
  expect((issued[0].sellerSnapshot as { version: number }).version).toBe(1);

  // Order.updatedAt (the admin CAS token) — and everything else about the
  // order — is exactly as it was before issuance.
  expect(await orderState(fixtures.legacy.id)).toBe(before);

  const href = await open.getAttribute('href');
  const first = await page.request.get(href!);
  expect(first.status()).toBe(200);
  expect(first.headers()['content-type']).toBe('application/pdf');
  expect(first.headers()['cache-control']).toContain('no-store');
  const bytes = await first.body();
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await testInfo.attach('commercial-proposal.pdf', { body: bytes, contentType: 'application/pdf' });

  const { flat } = await pdfText(bytes);
  const issuedDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Almaty' }).format(issued[0].issuedAt);
  expect(flat).toContain(`№ KP-${fixtures.legacy.orderNumber} от ${issuedDate}`);
  expect(flat).toContain(fixtures.legacy.companyName);
  expect(flat).toContain(`БИН ${fixtures.legacy.binIin}`);
  // Fixture totals: net 844 828, VAT 135 172, total 980 000; one row, 1 × 844 828.
  expect(flat).toContain('1 компл. × 844 828,00 ₸ = 844 828,00 ₸');
  expect(flat).toContain('Итого без НДС 844 828,00 ₸');
  expect(flat).toContain('НДС 16% 135 172,00 ₸');
  expect(flat).toContain('Итого с НДС 980 000,00 ₸');
  expect(flat).not.toContain('MS-UPR-2000');
  expect(flat).not.toContain('*');

  // Repeated GETs (inline, then download) render the same bytes and create
  // nothing further — GET never issues, only POST /issue does.
  const second = await page.request.get(href!);
  expect((await second.body()).equals(bytes)).toBe(true);
  const downloadResponse = await page.request.get(`${href}?download=1`);
  expect(downloadResponse.headers()['content-disposition']).toBe(`attachment; filename="KP-${fixtures.legacy.orderNumber}.pdf"`);
  expect((await downloadResponse.body()).equals(bytes)).toBe(true);
  expect(await prisma.orderDocument.count({ where: { orderId: fixtures.legacy.id } })).toBe(1);
  expect(await orderState(fixtures.legacy.id)).toBe(before);

  // Clicking "Сформировать" again (idempotent POST) changes nothing either.
  const reissue = await page.request.post(issuePath(fixtures.legacy.id, 'commercial-proposal'));
  expect(reissue.status()).toBe(200);
  const reissueJson = await reissue.json();
  expect(reissueJson.created).toBe(false);
  expect(reissueJson.number).toBe(`KP-${fixtures.legacy.orderNumber}`);
  expect(await prisma.orderDocument.count({ where: { orderId: fixtures.legacy.id } })).toBe(1);

  await page.reload();
  await expect(proposal.getByTestId('document-issued')).toContainText(`Выставлен ${issuedDate}`);
});

test('issuing a document does not make an open order page hit a false edit conflict', async ({ page, context, baseURL }) => {
  await signIn(context, 'ADMIN', baseURL!);
  // The page captures Order.updatedAt as its compare-and-swap token now…
  await page.goto(`/admin/orders/${fixtures.unassigned.id}`);
  // …then a document is issued for the same order (another tab, same admin)…
  expect((await page.request.post(issuePath(fixtures.unassigned.id, 'commercial-proposal'))).status()).toBe(201);
  expect(await prisma.orderDocument.count({ where: { orderId: fixtures.unassigned.id } })).toBe(1);
  // …and saving from the already-open page still succeeds.
  await page.getByTestId('internal-notes-input').fill('После выставления КП');
  await page.getByRole('button', { name: 'Сохранить заметку' }).click();
  await expect(page.getByText('Заметка сохранена.')).toBeVisible();
});

test('the invoice is either ready to issue or blocked with the exact missing seller settings — never faked', async ({ page, context, baseURL }) => {
  await signIn(context, 'ADMIN', baseURL!);
  await page.goto(`/admin/orders/${fixtures.unassigned.id}`);
  const invoice = page.getByTestId('order-documents').locator('[data-document-kind="invoice"]');

  if ((await invoice.getByTestId('document-blockers').count()) > 0) {
    await expect(invoice.getByRole('link')).toHaveCount(0);
    await expect(invoice.getByTestId('issue-document')).toHaveCount(0);
    await expect(invoice.getByTestId('document-blockers')).toContainText('SELLER_');

    const issueResponse = await page.request.post(issuePath(fixtures.unassigned.id, 'invoice'));
    expect(issueResponse.status()).toBe(422);
    const json = await issueResponse.json();
    expect((json.details as string[]).some((d) => d.includes('SELLER_'))).toBe(true);
    expect(await prisma.orderDocument.count({ where: { orderId: fixtures.unassigned.id, kind: 'INVOICE' } })).toBe(0);

    // GET never even mentions seller configuration — it only ever says
    // "not issued", regardless of whether issuing would succeed.
    const getResponse = await page.request.get(documentPath(fixtures.unassigned.id, 'invoice'));
    expect(getResponse.status()).toBe(409);
  } else {
    await clickWhenHydrated(invoice.getByTestId('issue-document'));
    await expect(invoice.getByRole('link', { name: 'Открыть PDF: Счёт на оплату' })).toBeVisible();
    const href = await invoice.getByRole('link', { name: 'Открыть PDF: Счёт на оплату' }).getAttribute('href');
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    const { flat } = await pdfText(await response.body());
    expect(flat).toContain(`№ INV-${fixtures.unassigned.orderNumber}`);
    expect(flat).toContain('Всего к оплате 145 000,00 ₸');
    expect(await prisma.orderDocument.count({ where: { orderId: fixtures.unassigned.id, kind: 'INVOICE' } })).toBe(1);
  }
});

test('an order placed before document snapshots explains why no document can be generated, from either route', async ({ page, context, baseURL }) => {
  await signIn(context, 'ADMIN', baseURL!);
  const before = await orderState(legacyOrder.id);
  await page.goto(`/admin/orders/${legacyOrder.id}`);

  for (const kind of ['commercial-proposal', 'invoice'] as const) {
    const entry = page.getByTestId('order-documents').locator(`[data-document-kind="${kind}"]`);
    await expect(entry.getByTestId('document-blockers')).toContainText('исторические данные');
    await expect(entry.getByTestId('document-blockers')).toContainText('Не сохранены данные покупателя на момент заказа.');
    await expect(entry.getByRole('link')).toHaveCount(0);
    await expect(entry.getByTestId('issue-document')).toHaveCount(0);

    const getResponse = await page.request.get(documentPath(legacyOrder.id, kind));
    expect(getResponse.status()).toBe(409);
    const getJson = await getResponse.json();
    expect(getJson.code).toBe('CONFLICT');
    expect((getJson.details as string[]).length).toBeGreaterThan(0);

    const issueResponse = await page.request.post(issuePath(legacyOrder.id, kind));
    expect(issueResponse.status()).toBe(409);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('heading', { name: 'Документы' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('order-documents-legacy.png'), fullPage: false });

  expect(await prisma.orderDocument.count({ where: { orderId: legacyOrder.id } })).toBe(0);
  expect(await orderState(legacyOrder.id)).toBe(before);
});

test('concurrent first POST /issue calls settle on one logical issuance', async ({ page, context, baseURL }) => {
  await signIn(context, 'MANAGER', baseURL!);
  const path = issuePath(raceOrder.id, 'commercial-proposal');
  const responses = await Promise.all([page.request.post(path), page.request.post(path), page.request.post(path)]);
  expect(responses.map((r) => r.status()).sort()).toEqual([200, 200, 201]);
  const bodies = await Promise.all(responses.map((r) => r.json()));
  expect(bodies[1].number).toBe(bodies[0].number);
  expect(bodies[2].number).toBe(bodies[0].number);
  expect(bodies[1].issuedAt).toBe(bodies[0].issuedAt);
  expect(await prisma.orderDocument.count({ where: { orderId: raceOrder.id } })).toBe(1);

  // The one logical document renders identically regardless of which
  // concurrent caller "won" the insert.
  const getResponse = await page.request.get(documentPath(raceOrder.id, 'commercial-proposal'));
  expect(getResponse.status()).toBe(200);
});

test('a later order from the same customer with new details does not change an earlier order\'s document', async ({ page, context, baseURL }, testInfo) => {
  // Both orders deliberately share ONE (phone, type) — that is the whole
  // point of the test — so the phone must be unique to this (project,
  // repetition) instead of derived from the project name alone: under
  // `--repeat-each` a project-only phone makes every repetition upsert the
  // same Customer row and overwrite each other's buyer details. The
  // checkoutPrefix already carries the repetition, and the client IP comes
  // from the same seed so the repetitions never share a rate-limit bucket.
  const identity = checkoutIdentity(checkoutPrefix, testInfo);
  const clientIp = simulatedClientIp(checkoutPrefix, testInfo);
  const place = async (p: Page, details: { fullName: string; companyName: string; email: string }) => {
    const response = await p.request.post('/api/orders', {
      headers: { 'x-forwarded-for': clientIp },
      data: {
        ...details,
        phone: identity.phone,
        city: 'Алматы',
        customerType: 'LEGAL_ENTITY',
        binIin: '123456789012',
        paymentPreference: 'BANK_INVOICE',
        items: [
          {
            configuration: {
              modelSlug: 'ms-standard',
              height: 2000,
              depth: 500,
              shelves: 5,
              sections: [{ id: 'sec-1', width: 1000, rearWall: false, leftWall: false, rightWall: false }],
              loadCapacity: 150,
              shelfType: 'STANDARD',
              colorId: 'color-grey',
              accessories: [],
              assemblyId: 'assembly-self',
              deliveryId: 'delivery-pickup',
              quantity: 1,
            },
          },
        ],
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()).orderNumber as string;
  };

  const first = { fullName: `${checkoutPrefix} Первое Имя`, companyName: 'ТОО «Первое Название»', email: 'first@e2e.invalid' };
  const orderANumber = await place(page, first);
  const orderA = await prisma.order.findUniqueOrThrow({ where: { orderNumber: orderANumber } });
  expect(orderA.buyerSnapshot).toMatchObject({ version: 1, fullName: first.fullName, companyName: first.companyName });

  await signIn(context, 'ADMIN', baseURL!);
  expect((await page.request.post(issuePath(orderA.id, 'commercial-proposal'))).status()).toBe(201);
  const path = documentPath(orderA.id, 'commercial-proposal');
  const pdfBefore = await (await page.request.get(path)).body();
  expect((await pdfText(pdfBefore)).flat).toContain('ТОО «Первое Название»');

  // Order B: same phone and type → the shared Customer row is overwritten.
  const second = { fullName: `${checkoutPrefix} Второе Имя`, companyName: 'ТОО «Второе Название»', email: 'second@e2e.invalid' };
  await place(page, second);
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: orderA.customerId } });
  expect(customer).toMatchObject({ fullName: second.fullName, companyName: second.companyName, email: second.email });

  const pdfAfter = await (await page.request.get(path)).body();
  expect(pdfAfter.equals(pdfBefore)).toBe(true);
  const { flat } = await pdfText(pdfAfter);
  expect(flat).toContain('ТОО «Первое Название»');
  expect(flat).toContain(first.fullName);
  for (const later of [second.fullName, second.companyName, second.email]) expect(flat).not.toContain(later);
});

test('document endpoints are admin-only', async ({ page, context, baseURL }) => {
  const getPath = documentPath(fixtures.legacy.id, 'commercial-proposal');
  const postPath = issuePath(fixtures.legacy.id, 'invoice');

  const anonymous = await playwrightRequest.newContext({ baseURL });
  expect((await anonymous.get(getPath)).status()).toBe(401);
  expect((await anonymous.post(postPath)).status()).toBe(401);
  await anonymous.dispose();

  await signIn(context, 'CONTENT_MANAGER', baseURL!);
  expect((await page.request.get(getPath)).status()).toBe(403);
  expect((await page.request.post(postPath)).status()).toBe(403);
  await page.goto(`/admin/orders/${fixtures.legacy.id}`);
  await expect(page.getByText('Недостаточно прав для формирования документов.')).toBeVisible();

  await signIn(context, 'MANAGER', baseURL!);
  // The proposal was already issued by an earlier test — GET succeeds
  // directly, without MANAGER needing to issue anything.
  expect((await page.request.get(getPath)).status()).toBe(200);
  expect((await page.request.get('/api/admin/orders/cdoesnotexist0000000000000/documents/invoice')).status()).toBe(404);
  expect((await page.request.get(`/api/admin/orders/${fixtures.legacy.id}/documents/receipt`)).status()).toBe(404);
  expect((await page.request.post('/api/admin/orders/cdoesnotexist0000000000000/documents/invoice/issue')).status()).toBe(404);
  expect((await page.request.post(`/api/admin/orders/${fixtures.legacy.id}/documents/receipt/issue`)).status()).toBe(404);
});
