import { test, expect } from './helpers/test';
import type { BrowserContext, Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import {
  assignManagerBehindTheUi,
  createOrderFixtures,
  createPrismaClient,
  orderFixturePrefix,
  readOrder,
  removeOrderFixtures,
  sessionCookieFor,
  setInternalNotesBehindTheUi,
  type FixtureRole,
  type OrderFixtures,
} from './helpers/admin-order-fixtures';
import { clickWhenHydrated } from './helpers/hydration';

/**
 * /admin/orders — the order queue and one order's detail screen.
 *
 * Like the rest of the admin area this is PostgreSQL-only (see
 * docs/production-database.md), so the whole file skips cleanly without a
 * real DATABASE_URL.
 *
 * Every test acts only on the three orders this project created for itself,
 * addressed by their deterministic order numbers — never on a real customer's
 * order, and never on "whatever happens to be first in the list". The desktop
 * and mobile projects therefore cannot interfere with each other even though
 * they run in parallel against one database.
 *
 * Sessions are minted directly rather than typed into the login form: the
 * production rate limiter stays exactly as strict as it is, and these tests
 * simply do not knock on that door. tests/e2e/admin.spec.ts covers the form.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);

test.skip(!hasDatabase, 'requires a real PostgreSQL DATABASE_URL — see docs/production-database.md');

// The assignment/notes tests mutate the same fixture orders, so within one
// project they must not overlap either.
test.describe.configure({ mode: 'serial' });

let prisma: PrismaClient;
let fixtures: OrderFixtures;

test.beforeAll(async ({}, testInfo) => {
  prisma = createPrismaClient();
  // The repeat index is part of the prefix: `--repeat-each=N` runs the
  // repetitions in parallel, and each copy's fixtures must be its own.
  fixtures = await createOrderFixtures(
    prisma,
    orderFixturePrefix(testInfo.project.name, testInfo.repeatEachIndex),
  );
});

test.afterAll(async () => {
  if (!prisma) return;
  await removeOrderFixtures(prisma, fixtures.prefix);
  await prisma.$disconnect();
});

async function signIn(context: BrowserContext, role: FixtureRole, baseURL: string): Promise<void> {
  await context.clearCookies();
  await context.addCookies([await sessionCookieFor(fixtures.users[role], baseURL)]);
}

test.beforeEach(async ({ context, baseURL }) => {
  await signIn(context, 'ADMIN', baseURL!);
});

/** Rows of the list, whichever layout the viewport is showing. */
function visibleRows(page: Page) {
  return page.locator('[data-testid="order-row"]:visible, [data-testid="order-card"]:visible');
}

function rowFor(page: Page, orderNumber: string) {
  return page.locator(
    `[data-testid="order-row"][data-order-number="${orderNumber}"]:visible,` +
      `[data-testid="order-card"][data-order-number="${orderNumber}"]:visible`,
  );
}

/**
 * Submits the filter bar and waits for the navigation it causes.
 *
 * The form navigates to a canonical URL (see AdminOrdersFilters), which is a
 * client-side transition — waiting for the expected URL is what stops a
 * later assertion from reading the previous page's rows.
 */
async function applyFilters(page: Page, expectedUrl: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page).toHaveURL(expectedUrl);
}

/** Runs a search through the list's own filter form. */
async function search(page: Page, term: string): Promise<void> {
  await page.goto('/admin/orders');
  await page.getByLabel('Поиск').fill(term);
  await applyFilters(page, /[?&]q=/);
  await expect(page.getByRole('heading', { name: 'Заказы' })).toBeVisible();
}

test.describe('search', () => {
  test('finds an order by its number', async ({ page }) => {
    await search(page, fixtures.unassigned.orderNumber);
    await expect(rowFor(page, fixtures.unassigned.orderNumber)).toBeVisible();
    await expect(visibleRows(page)).toHaveCount(1);
  });

  test('finds an order by customer name', async ({ page }) => {
    await search(page, fixtures.unassigned.customerName);
    await expect(rowFor(page, fixtures.unassigned.orderNumber)).toBeVisible();
  });

  test('finds an order by phone, however the manager types it', async ({ page }) => {
    // Stored as +7900XXXXXXX; a manager may type it with 8, with spaces, or
    // as the bare subscriber digits.
    const subscriber = fixtures.unassigned.customerPhone.replace('+7', '');
    await search(page, `8 ${subscriber}`);
    await expect(rowFor(page, fixtures.unassigned.orderNumber)).toBeVisible();
  });

  test('finds a legal entity by company name and by BIN/IIN', async ({ page }) => {
    await search(page, fixtures.legacy.companyName);
    await expect(rowFor(page, fixtures.legacy.orderNumber)).toBeVisible();

    await search(page, fixtures.legacy.binIin);
    await expect(rowFor(page, fixtures.legacy.orderNumber)).toBeVisible();
  });

  test('shows an empty state rather than the whole queue when nothing matches', async ({ page }) => {
    await search(page, `${fixtures.prefix}-НЕТ-ТАКОГО`);
    await expect(page.getByText('Заказов не найдено.')).toBeVisible();
    await expect(visibleRows(page)).toHaveCount(0);
  });
});

test.describe('filters', () => {
  test('filters by status', async ({ page }) => {
    await page.goto('/admin/orders');
    await page.getByLabel('Поиск').fill(fixtures.prefix);
    await page.getByLabel('Статус').selectOption('NEW');
    await applyFilters(page, /status=NEW/);

    await expect(rowFor(page, fixtures.unassigned.orderNumber)).toBeVisible();
    await expect(rowFor(page, fixtures.assigned.orderNumber)).toHaveCount(0);
  });

  test('filters by responsible manager, including "без менеджера"', async ({ page }) => {
    await page.goto('/admin/orders');
    await page.getByLabel('Поиск').fill(fixtures.prefix);
    await page.getByLabel('Ответственный').selectOption('UNASSIGNED');
    await applyFilters(page, /manager=UNASSIGNED/);

    await expect(rowFor(page, fixtures.unassigned.orderNumber)).toBeVisible();
    await expect(rowFor(page, fixtures.assigned.orderNumber)).toHaveCount(0);

    await page.getByLabel('Ответственный').selectOption(fixtures.otherManager.id);
    await applyFilters(page, new RegExp(`manager=${fixtures.otherManager.id}`));
    await expect(rowFor(page, fixtures.assigned.orderNumber)).toBeVisible();
    await expect(rowFor(page, fixtures.unassigned.orderNumber)).toHaveCount(0);
  });

  test('filters by customer type', async ({ page }) => {
    await page.goto('/admin/orders');
    await page.getByLabel('Поиск').fill(fixtures.prefix);
    await page.getByLabel('Тип клиента').selectOption('LEGAL_ENTITY');
    await applyFilters(page, /customerType=LEGAL_ENTITY/);

    await expect(rowFor(page, fixtures.legacy.orderNumber)).toBeVisible();
    await expect(rowFor(page, fixtures.unassigned.orderNumber)).toHaveCount(0);
  });

  test('filters by date range — a 40-day-old order falls outside the last 7 days', async ({ page }) => {
    await page.goto('/admin/orders');
    await page.getByLabel('Поиск').fill(fixtures.prefix);
    await page.getByLabel('Период').selectOption('LAST_7_DAYS');
    await applyFilters(page, /range=LAST_7_DAYS/);

    await expect(rowFor(page, fixtures.unassigned.orderNumber)).toBeVisible();
    await expect(rowFor(page, fixtures.legacy.orderNumber)).toHaveCount(0);
  });

  test('keeps the filters in the URL, so the view is shareable and survives a reload', async ({ page }) => {
    await page.goto('/admin/orders');
    await page.getByLabel('Поиск').fill(fixtures.prefix);
    await page.getByLabel('Статус').selectOption('NEW');
    await applyFilters(page, /status=NEW/);

    await page.reload();
    await expect(rowFor(page, fixtures.unassigned.orderNumber)).toBeVisible();
    await expect(rowFor(page, fixtures.assigned.orderNumber)).toHaveCount(0);
  });

  test('"Сбросить" returns to the unfiltered queue', async ({ page }) => {
    await search(page, fixtures.unassigned.orderNumber);
    await page.getByRole('link', { name: 'Сбросить' }).click();
    await expect(page).toHaveURL(/\/admin\/orders$/);
  });

  test('the "Без менеджера" counter is a shortcut to that filter', async ({ page }) => {
    await page.goto('/admin/orders');
    await page.getByRole('link', { name: /Без менеджера/ }).click();
    await expect(page).toHaveURL(/manager=UNASSIGNED/);
  });
});

test.describe('layout', () => {
  test('marks new orders apart from the rest', async ({ page }) => {
    await search(page, fixtures.prefix);
    await expect(rowFor(page, fixtures.unassigned.orderNumber)).toHaveAttribute('data-status', 'NEW');
    await expect(rowFor(page, fixtures.assigned.orderNumber)).toHaveAttribute('data-status', 'CONFIRMED');
  });

  test('never scrolls the page sideways', async ({ page }) => {
    await search(page, fixtures.prefix);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('shows a table on a wide screen and cards on a narrow one', async ({ page }, testInfo) => {
    await search(page, fixtures.prefix);
    const isMobile = (testInfo.project.use.viewport?.width ?? 1280) < 1024;
    await expect(page.locator('[data-testid="order-card"]').first()).toBeVisible({ visible: isMobile });
    await expect(page.locator('[data-testid="order-row"]').first()).toBeVisible({ visible: !isMobile });
  });

  test('opens an order from the list', async ({ page }) => {
    await search(page, fixtures.unassigned.orderNumber);
    await rowFor(page, fixtures.unassigned.orderNumber)
      .getByRole('link', { name: fixtures.unassigned.orderNumber })
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/${fixtures.unassigned.id}`));
  });
});

test.describe('manager assignment', () => {
  test.beforeEach(async () => {
    // Each test starts from a known assignment, whatever the previous one did.
    await assignManagerBehindTheUi(prisma, fixtures.unassigned.id, null);
    await assignManagerBehindTheUi(prisma, fixtures.assigned.id, fixtures.assigned.managerId);
  });

  /**
   * Picks a manager, saves, and waits for the refresh that save triggers.
   *
   * OrderManagerForm sends `expectedUpdatedAt` — the order's updatedAt as the
   * page last rendered it — and receives a fresh one only when the router
   * refresh after a successful save re-renders the form. Saving again before
   * that lands sends the stale token, and the server correctly answers 409
   * ("Заказ уже был изменён"). A person cannot outrun that refresh; a test
   * driving three saves in a row on a server busy with the rest of the suite
   * can, which is what made this the one test that passed alone and failed in
   * a full run.
   *
   * The wait is on the button going back to disabled: it re-disables only
   * when `selected === serverValue`, and `serverValue` arrives in the very
   * same render as the fresh `expectedUpdatedAt`. Waiting for the notice
   * first keeps this from matching the transient "Сохраняем…" disabled state.
   */
  async function assignManagerThroughTheUi(page: Page, managerId: string): Promise<void> {
    const save = page.getByRole('button', { name: 'Сохранить', exact: true });
    await page.getByLabel('Ответственный менеджер').selectOption(managerId);
    await save.click();
    await expect(page.getByText('Ответственный обновлён.')).toBeVisible();
    await expect(save).toBeDisabled();
  }

  test('an admin assigns, reassigns and then releases an order', async ({ page }) => {
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`);

    await assignManagerThroughTheUi(page, fixtures.users.MANAGER.id);
    expect((await readOrder(prisma, fixtures.unassigned.id)).managerId).toBe(fixtures.users.MANAGER.id);

    await assignManagerThroughTheUi(page, fixtures.otherManager.id);
    expect((await readOrder(prisma, fixtures.unassigned.id)).managerId).toBe(fixtures.otherManager.id);

    await assignManagerThroughTheUi(page, '');
    expect((await readOrder(prisma, fixtures.unassigned.id)).managerId).toBeNull();
  });

  test('a manager sees "Взять заказ" on a free order and claims it for themselves', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, 'MANAGER', baseURL!);
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`);

    // Not a plain click(): "Взять заказ" is enabled in the server-rendered
    // HTML, so a click can land before React has attached its onClick and be
    // dropped without a trace. See helpers/hydration.ts.
    await clickWhenHydrated(page.getByRole('button', { name: 'Взять заказ' }));

    await expect(page.getByTestId('order-manager-value')).toHaveText(fixtures.users.MANAGER.name);
    expect((await readOrder(prisma, fixtures.unassigned.id)).managerId).toBe(fixtures.users.MANAGER.id);
  });

  /**
   * The full-run-only flake this file used to have, made deterministic.
   *
   * Holding the client bundle puts the button on screen — visible, enabled
   * and completely inert — at the moment the click lands, which is exactly
   * the state a loaded machine produced by accident. With a plain click()
   * this test fails: nothing is sent and the order stays unassigned.
   */
  test('a claim made before the page has hydrated still reaches the server', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, 'MANAGER', baseURL!);
    await page.route('**/*.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue();
    });
    // 'commit' so the wait for the held scripts happens *after* this returns.
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`, { waitUntil: 'commit' });

    await clickWhenHydrated(page.getByRole('button', { name: 'Взять заказ' }));

    await expect(page.getByTestId('order-manager-value')).toHaveText(fixtures.users.MANAGER.name);
    expect((await readOrder(prisma, fixtures.unassigned.id)).managerId).toBe(fixtures.users.MANAGER.id);
  });

  test('a manager gets no control at all on an order someone else holds', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, 'MANAGER', baseURL!);
    await page.goto(`/admin/orders/${fixtures.assigned.id}`);

    await expect(page.getByTestId('order-manager-value')).toHaveText(fixtures.assigned.managerName);
    await expect(page.getByRole('button', { name: 'Взять заказ' })).toHaveCount(0);
    await expect(page.getByLabel('Ответственный менеджер')).toHaveCount(0);
  });

  test('a manager cannot release an order after claiming it', async ({ page, context, baseURL }) => {
    await assignManagerBehindTheUi(prisma, fixtures.unassigned.id, fixtures.users.MANAGER.id);
    await signIn(context, 'MANAGER', baseURL!);
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`);

    await expect(page.getByTestId('order-manager-value')).toHaveText(fixtures.users.MANAGER.name);
    await expect(page.getByRole('button', { name: 'Взять заказ' })).toHaveCount(0);
    await expect(page.getByLabel('Ответственный менеджер')).toHaveCount(0);
  });

  test('a content manager sees the responsible manager but can change nothing', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, 'CONTENT_MANAGER', baseURL!);
    await page.goto(`/admin/orders/${fixtures.assigned.id}`);

    await expect(page.getByTestId('order-manager-value')).toHaveText(fixtures.assigned.managerName);
    await expect(page.getByLabel('Ответственный менеджер')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Взять заказ' })).toHaveCount(0);
    await expect(page.getByTestId('internal-notes-input')).toHaveCount(0);
  });

  test('a claim loses to whoever got there first, and says so instead of overwriting', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, 'MANAGER', baseURL!);
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`);
    await expect(page.getByRole('button', { name: 'Взять заказ' })).toBeVisible();

    // A colleague takes it while this page is open.
    await assignManagerBehindTheUi(prisma, fixtures.unassigned.id, fixtures.otherManager.id);

    await clickWhenHydrated(page.getByRole('button', { name: 'Взять заказ' }));
    await expect(page.getByTestId('order-manager-error')).toContainText('уже был изменён');
    expect((await readOrder(prisma, fixtures.unassigned.id)).managerId).toBe(fixtures.otherManager.id);
  });

  test('the assignment is recorded in the order timeline', async ({ page }) => {
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`);
    await assignManagerThroughTheUi(page, fixtures.users.MANAGER.id);

    await page.reload();
    await expect(page.getByTestId('order-activity')).toContainText(fixtures.users.ADMIN.name);
    await expect(page.getByTestId('order-activity')).toContainText(fixtures.users.MANAGER.name);
  });
});

test.describe('internal notes', () => {
  test.beforeEach(async () => {
    await setInternalNotesBehindTheUi(prisma, fixtures.unassigned.id, null);
  });

  test('a manager writes a note and it survives a reload', async ({ page, context, baseURL }) => {
    await signIn(context, 'MANAGER', baseURL!);
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`);

    await page.getByTestId('internal-notes-input').fill('Перезвонить после 18:00');
    await page.getByRole('button', { name: 'Сохранить заметку' }).click();
    await expect(page.getByText('Заметка сохранена.')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('internal-notes-input')).toHaveValue('Перезвонить после 18:00');
    expect((await readOrder(prisma, fixtures.unassigned.id)).internalNotes).toBe('Перезвонить после 18:00');
  });

  test('markup pasted into a note is stored as plain text', async ({ page }) => {
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`);
    await page.getByTestId('internal-notes-input').fill('<b>срочно</b><script>alert(1)</script>');
    await page.getByRole('button', { name: 'Сохранить заметку' }).click();
    await expect(page.getByText('Заметка сохранена.')).toBeVisible();

    expect((await readOrder(prisma, fixtures.unassigned.id)).internalNotes).toBe('срочно');
  });

  test('a note edited by someone else is not overwritten by a stale tab', async ({ page }) => {
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`);
    await page.getByTestId('internal-notes-input').fill('моя версия');

    await setInternalNotesBehindTheUi(prisma, fixtures.unassigned.id, 'версия коллеги');

    await page.getByRole('button', { name: 'Сохранить заметку' }).click();
    await expect(page.getByTestId('internal-notes-error')).toContainText('уже была изменена');
    expect((await readOrder(prisma, fixtures.unassigned.id)).internalNotes).toBe('версия коллеги');
  });

  test('a content manager reads the note but has no editor', async ({ page, context, baseURL }) => {
    await setInternalNotesBehindTheUi(prisma, fixtures.unassigned.id, 'только для чтения');
    await signIn(context, 'CONTENT_MANAGER', baseURL!);
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`);

    await expect(page.getByTestId('internal-notes-text')).toHaveText('только для чтения');
    await expect(page.getByTestId('internal-notes-input')).toHaveCount(0);
  });
});

test.describe('order detail content', () => {
  test('shows the persisted totals, delivery and internal BOM, and never reprices', async ({ page }) => {
    await page.goto(`/admin/orders/${fixtures.legacy.id}`);

    await expect(page.getByText('Без НДС')).toBeVisible();
    await expect(page.getByText('НДС', { exact: true })).toBeVisible();
    await expect(page.getByText('Скидка')).toBeVisible();
    // 980 000 ₸ as persisted — a 40-day-old order must not be recalculated
    // against today's catalog.
    await expect(page.getByTestId('order-grand-total')).toContainText('980');

    await expect(page.getByText('Город доставки')).toBeVisible();
    await expect(page.getByText('MS-UPR-2000')).toBeVisible();
    await expect(page.getByText(fixtures.legacy.binIin)).toBeVisible();
  });

  test('offers a WhatsApp action for the customer’s own number', async ({ page }) => {
    await page.goto(`/admin/orders/${fixtures.unassigned.id}`);
    const link = page.getByRole('link', { name: 'Написать клиенту в WhatsApp' });
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(`wa\\.me/${fixtures.unassigned.customerPhone.replace('+', '')}`),
    );
  });

  test('never scrolls the page sideways', async ({ page }) => {
    await page.goto(`/admin/orders/${fixtures.legacy.id}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
