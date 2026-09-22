import { test, expect } from './helpers/test';

/**
 * End-to-end coverage for the front/top preview-mode switch: it must never
 * touch configuration state, never fire a pricing request, and section
 * selection made in top view must stay in sync with the section table.
 */

test('switching between front and top view causes zero pricing requests and preserves state', async ({ page }) => {
  const pricingRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/pricing/calculate')) pricingRequests.push(req.url());
  });

  await page.goto('/ru/configurator');

  // Default is front view: front-view drag handles are present.
  await expect(page.locator('button[data-axis="height"]')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Схема стеллажа спереди' })).toBeVisible();

  const widthBefore = await page.locator('select[aria-label="Ширина секции 1"]').inputValue();
  await expect.poll(() => pricingRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const requestsBeforeSwitch = pricingRequests.length;

  // Switch to top view.
  await page.getByRole('button', { name: 'Вид сверху' }).click();
  await expect(page.getByRole('img', { name: 'Схема стеллажа сверху' })).toBeVisible();
  await expect(page.locator('button[data-axis="height"]')).toHaveCount(0);

  // Give the debounced pricing effect (300ms) time to fire if it were going to.
  await page.waitForTimeout(600);
  expect(pricingRequests.length).toBe(requestsBeforeSwitch);

  // Config is untouched by the switch.
  await expect(page.locator('select[aria-label="Ширина секции 1"]')).toHaveValue(widthBefore);

  // Selecting a section in top view stays in sync with the section table.
  await page.getByRole('button', { name: /Секция 1, ширина/ }).first().click();
  await expect(page.getByRole('button', { name: 'Секция 1', exact: true })).toHaveAttribute('class', /dimension-accent/);

  // Switch back to front view — still zero extra pricing requests, state unchanged.
  await page.getByRole('button', { name: 'Вид спереди' }).click();
  await expect(page.locator('button[data-axis="height"]')).toBeVisible();
  await page.waitForTimeout(600);
  expect(pricingRequests.length).toBe(requestsBeforeSwitch);
  await expect(page.locator('select[aria-label="Ширина секции 1"]')).toHaveValue(widthBefore);
});
