import type { PrismaClient } from '@prisma/client';
import { test, expect } from './helpers/test';
import { hashPassword } from '../../src/lib/auth/password';
import { SESSION_COOKIE_NAME, createSessionToken } from '../../src/lib/auth/session';

/**
 * /admin/leads — the read-only contact-lead list. PostgreSQL-only like the rest
 * of the admin area, so the file skips cleanly without a real DATABASE_URL.
 *
 * Each project creates its own admin account and its own leads (reserved
 * +7906… phones, a per-project name prefix) and deletes exactly those rows
 * afterwards. One lead carries markup in every field, to prove it is shown as
 * text and never executed.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL?.startsWith('postgres'));
test.skip(!hasDatabase, 'requires a real PostgreSQL DATABASE_URL — see docs/production-database.md');
// One set of fixture rows per project, shared by this file's tests.
test.describe.configure({ mode: 'serial' });

let prisma: PrismaClient;
let prefix: string;
let admin: { id: string; email: string; name: string; role: 'CONTENT_MANAGER' };
const leadIds: string[] = [];
const XSS = '<img src=x onerror="window.__leadXss=1"><script>window.__leadXss=1</script>';

test.beforeAll(async ({}, testInfo) => {
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
  prefix = `E2E${testInfo.repeatEachIndex}XLEADS-${testInfo.project.name}`;
  // Viewing leads needs only a valid session: the most restricted role is enough.
  const created = await prisma.user.create({
    data: {
      email: `${prefix.toLowerCase()}@e2e.invalid`,
      name: `${prefix} viewer`,
      passwordHash: hashPassword('E2eLeadsFixture123!'),
      role: 'CONTENT_MANAGER',
      active: true,
    },
    select: { id: true, email: true, name: true },
  });
  admin = { ...created, role: 'CONTENT_MANAGER' };

  const phone = () => `+7906${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
  const plain = await prisma.contactLead.create({
    data: { name: `${prefix} Клиент`, phone: phone(), message: 'Нужен стеллаж на склад', locale: 'ru' },
  });
  const long = await prisma.contactLead.create({
    data: { name: `${prefix} ${XSS}`, phone: phone(), message: `${XSS} ${'длинное сообщение '.repeat(20)}конец`, locale: 'kk' },
  });
  leadIds.push(plain.id, long.id);
  const payload = (id: string) => ({ event: 'contact.created', contactLeadId: id, occurredAt: new Date().toISOString() });
  await prisma.notificationDelivery.createMany({
    data: [
      { event: 'contact.created', channel: 'whatsapp', status: 'SENT', contactLeadId: plain.id, payload: payload(plain.id), attempts: 1 },
      { event: 'contact.created', channel: 'whatsapp', status: 'FAILED', contactLeadId: long.id, payload: payload(long.id), attempts: 6, lastError: 'HTTP_503' },
    ],
  });
});

test.afterAll(async () => {
  if (!prisma) return;
  await prisma.notificationDelivery.deleteMany({ where: { contactLeadId: { in: leadIds } } });
  await prisma.contactLead.deleteMany({ where: { id: { in: leadIds } } });
  if (admin) await prisma.user.deleteMany({ where: { id: admin.id } });
  await prisma.$disconnect();
});

test.beforeEach(async ({ context, baseURL }) => {
  await context.clearCookies();
  await context.addCookies([{ name: SESSION_COOKIE_NAME, value: await createSessionToken(admin), url: baseURL! }]);
});

test('lists leads newest first with their alert state; customer text is escaped', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/admin/leads');
  await expect(page.getByRole('heading', { name: 'Заявки' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Заявки' })).toHaveAttribute('aria-current', 'page');

  const items = page.locator('[data-testid="lead-row"]:visible, [data-testid="lead-card"]:visible');
  const plain = items.filter({ hasText: `${prefix} Клиент` });
  const long = items.filter({ hasText: `${prefix} <img` });
  await expect(plain).toHaveCount(1);
  await expect(long).toHaveCount(1);
  await expect(plain).toContainText('Нужен стеллаж на склад');
  await expect(plain).toContainText('WhatsApp: отправлено');
  await expect(long).toContainText('WhatsApp: не доставлено');

  // Markup is text: visible literally, never parsed into elements, never run.
  await expect(long).toContainText('<script>window.__leadXss=1</script>');
  expect(await long.locator('img, script').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __leadXss?: number }).__leadXss)).toBeUndefined();

  // A long message is previewed; the full text is one tap away.
  await expect(long.locator('summary')).toBeVisible();
  await long.locator('summary').click();
  await expect(long).toContainText('конец');

  // Newest first: the second fixture lead is listed above the first.
  const texts = await items.allTextContents();
  const longIndex = texts.findIndex((t) => t.includes(`${prefix} <img`));
  const plainIndex = texts.findIndex((t) => t.includes(`${prefix} Клиент`));
  expect(longIndex).toBeLessThan(plainIndex);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('without a session /admin/leads is not reachable', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/admin/leads');
  await expect(page).toHaveURL(/\/admin\/login/);
});
