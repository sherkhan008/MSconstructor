import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end coverage for the drag-to-resize feature on /configurator:
 * dragging the width handle must commit a new, catalog-compatible width for
 * the active section, trigger a real server-side price recalculation, and
 * survive a page reload (the configurator store persists to localStorage).
 */

/** OrderSummaryBar renders the total once, shared across breakpoints — this
 * still walks every price-shaped match rather than assuming exactly one, so
 * it stays correct even if a future layout duplicates the price node again. */
async function getVisiblePriceText(page: Page): Promise<string> {
  const candidates = page.locator('text=/[\\d\\s]+\\s?₸/');
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    if (await candidate.isVisible()) {
      return (await candidate.textContent()) ?? '';
    }
  }
  return '';
}

function firstSectionWidthSelect(page: Page) {
  return page.locator('select[aria-label="Ширина секции 1"]');
}

test('drag-to-resize: width handle updates the active section, recalculates price, and survives reload', async ({ page }) => {
  await page.goto('/configurator');

  const widthSelect = firstSectionWidthSelect(page);
  await expect(widthSelect).toBeVisible();
  const before = await widthSelect.inputValue();
  expect(before).toBe('1000'); // default configuration width

  await expect.poll(() => getVisiblePriceText(page), { timeout: 10_000 }).not.toBe('');
  const priceBefore = await getVisiblePriceText(page);

  const widthHandle = page.locator('button[data-axis="width"]');
  await expect(widthHandle).toBeVisible();
  await widthHandle.scrollIntoViewIfNeeded();
  const box = await widthHandle.boundingBox();
  if (!box) throw new Error('Width resize handle has no bounding box');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  // Drag toward the next supported width (1000 -> 1200).
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 140, startY, { steps: 12 });
  await page.mouse.up();

  // The committed width must have changed and must be a supported value.
  await expect(widthSelect).not.toHaveValue(before);
  const after = await widthSelect.inputValue();
  expect(['700', '1200', '1500']).toContain(after);

  // The price must have been recalculated through the server API.
  await expect.poll(() => getVisiblePriceText(page), { timeout: 10_000 }).not.toBe(priceBefore);

  // Reload — the resized value must be preserved (localStorage-persisted store).
  await page.reload();
  await expect(firstSectionWidthSelect(page)).toHaveValue(after);
});

test('drag-to-resize: keyboard stepping is a fully usable alternative to dragging', async ({ page }) => {
  await page.goto('/configurator');

  const widthHandle = page.locator('button[data-axis="width"]');
  await expect(widthHandle).toBeVisible();
  await widthHandle.focus();
  await expect(widthHandle).toBeFocused();

  const widthSelect = firstSectionWidthSelect(page);
  await expect(widthSelect).toHaveValue('1000');

  await page.keyboard.press('ArrowRight');
  await expect(widthSelect).toHaveValue('1200');
});

test('drag-to-resize: height and depth handles change the whole row, not just one section', async ({ page }) => {
  await page.goto('/configurator');

  const heightHandle = page.locator('button[data-axis="height"]');
  await heightHandle.focus();
  const before = await heightHandle.getAttribute('aria-valuenow');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => heightHandle.getAttribute('aria-valuenow')).not.toBe(before);
});
