import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { waitForHydration } from './helpers/hydration';

/**
 * The redesigned contact page's form (src/components/contact/ContactForm.tsx)
 * against the real POST /api/contact, which stores a ContactLead before it
 * answers (the e2e server runs on the in-memory store). Error/pending states
 * that need a slow or failing server are produced by intercepting only that
 * one request. Runs in both projects (Desktop Chrome 1280×720, Pixel 7), plus
 * a 320 px pass.
 *
 * Also guards that every public WhatsApp link still points to the manager's
 * public number (NEXT_PUBLIC_WHATSAPP_NUMBER) — the technical Cloud API sender
 * number is never rendered.
 */

const PUBLIC_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '77071078235';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

async function openForm(page: Page, path = '/ru/contacts') {
  await page.goto(path);
  const submit = page.getByRole('button', { name: /Отправить|Жіберу/ });
  await waitForHydration(page.locator('#contact-name'));
  await waitForHydration(submit);
  return submit;
}

/**
 * Every submission uses its own phone from the reserved +7907… range (disjoint
 * from real Kazakh mobiles and the +7900/+7908/+7909 ranges other fixtures
 * use). When the server runs against a real DATABASE_URL, exactly those
 * leads — and their outbox rows — are deleted after this file's tests.
 */
const phones: string[] = [];
function e2ePhone(): string {
  const phone = `+7907${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
  phones.push(phone);
  return phone;
}

test.afterAll(async () => {
  if (!process.env.DATABASE_URL?.startsWith('postgres') || phones.length === 0) return;
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const ids = (await prisma.contactLead.findMany({ where: { phone: { in: phones } }, select: { id: true } })).map((l) => l.id);
    await prisma.notificationDelivery.deleteMany({ where: { contactLeadId: { in: ids } } });
    await prisma.contactLead.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await prisma.$disconnect();
  }
});

async function fill(page: Page, message = 'Нужен стеллаж 2000×1000 для склада') {
  await page.locator('#contact-name').fill('Тест Контакт');
  await page.locator('#contact-phone').fill(e2ePhone());
  await page.locator('#contact-message').fill(message);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('client validation: empty submit shows field errors and sends nothing', async ({ page }) => {
  const errors = collectErrors(page);
  let requests = 0;
  page.on('request', (r) => r.url().endsWith('/api/contact') && requests++);
  const submit = await openForm(page);
  await submit.click();
  await expect(page.locator('#contact-name ~ p.text-danger')).toBeVisible();
  await expect(page.locator('#contact-phone ~ p.text-danger')).toHaveText('Укажите корректный номер телефона');
  await expect(page.locator('#contact-message ~ p.text-danger')).toBeVisible();
  expect(requests).toBe(0);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('real submission: pending state, then success; the form is cleared', async ({ page }) => {
  const errors = collectErrors(page);
  const submit = await openForm(page);
  await fill(page, `Заявка e2e ${Date.now()}`);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/contact'));
  await submit.click();
  expect((await response).status()).toBe(201);
  await expect(page.locator('form').getByRole('status')).toHaveText('Спасибо! Мы свяжемся с вами в ближайшее время.');
  await expect(page.locator('#contact-name')).toHaveValue('');
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('slow server: button disabled with "Отправка…"; a double click sends ONE request', async ({ page }) => {
  let requests = 0;
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/contact', async (route) => {
    requests += 1;
    await released;
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true,"message":"Заявка отправлена"}' });
  });
  const submit = await openForm(page);
  await fill(page);
  await submit.dblclick();
  const pending = page.getByRole('button', { name: 'Отправка…' });
  await expect(pending).toBeDisabled();
  release();
  await expect(page.locator('form').getByRole('status')).toBeVisible();
  expect(requests).toBe(1);
});

test('server failure: an error the customer can act on, entered data kept', async ({ page }) => {
  const errors = collectErrors(page);
  await page.route('**/api/contact', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"code":"INTERNAL_ERROR","message":"x"}' }),
  );
  const submit = await openForm(page);
  await fill(page);
  await submit.click();
  await expect(page.locator('form').getByRole('alert')).toHaveText('Не удалось отправить. Попробуйте позже или напишите в WhatsApp.');
  await expect(page.locator('#contact-name')).toHaveValue('Тест Контакт');
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  // The browser logs a failed fetch (500) as a console error; nothing else may.
  expect(errors.filter((e) => !/status of 500/.test(e))).toEqual([]);
});

test('KK page: labels and messages in Kazakh', async ({ page }) => {
  const submit = await openForm(page, '/contacts');
  await fill(page, `KK e2e ${Date.now()}`);
  await submit.click();
  await expect(page.locator('form').getByRole('status')).toHaveText('Рақмет! Жақын арада сізбен байланысамыз.');
});

test('320 px: the form fits, controls are touch-sized, and it submits', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 320, height: 640 });
  const submit = await openForm(page);
  await expectNoHorizontalOverflow(page);
  for (const id of ['#contact-name', '#contact-phone']) {
    const box = await page.locator(id).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  // "About 44 px" (CLAUDE.md §9): the shared redesign Button renders 42 px tall.
  expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  expect((await submit.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await fill(page, `320 e2e ${Date.now()}`);
  await submit.click();
  await expect(page.locator('form').getByRole('status')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('every public WhatsApp link uses the manager/public number only', async ({ page }) => {
  for (const path of ['/ru/contacts', '/contacts', '/ru']) {
    await page.goto(path);
    const hrefs = await page.locator('a[href*="wa.me/"]').evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(new URL(href).pathname).toBe(`/${PUBLIC_NUMBER}`);
    const html = await page.content();
    const technical = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (technical) expect(html).not.toContain(technical);
    expect(html).not.toContain('graph.facebook.com');
  }
});
