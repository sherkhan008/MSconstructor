import { test, expect } from './helpers/test';
import { storedActiveConfiguration } from './helpers/sections';

/**
 * End-to-end coverage for two follow-up configurator changes:
 *  - the customer-facing shelf-type selector was removed (MS Standard now
 *    only offers STANDARD, so there is nothing left to choose);
 *  - only commercially priced public accessories appear in
 *    "Дополнительные параметры"; unpriced flags must stay unavailable to
 *    customer configuration.
 */

async function openAdvancedSettings(page: import('@playwright/test').Page) {
  const toggle = page.getByRole('button', { name: /Дополнительные параметры/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

test('the customer configurator has no shelf-type selector', async ({ page }) => {
  await page.goto('/ru/configurator');
  await openAdvancedSettings(page);
  const bodyText = await page.textContent('body');
  expect(bodyText).not.toContain('Тип полки');
  expect(bodyText).not.toContain('Перфорированная');
  expect(bodyText).not.toContain('Оцинкованная');
});

test('only priced public rack options are visible, real, and survive a reload', async ({ page }) => {
  await page.goto('/ru/configurator');
  await openAdvancedSettings(page);

  await expect(page.getByText('Регулируемая по высоте опора')).toBeVisible();
  await expect(page.getByText('Ребро жесткости в каждую полку')).toBeVisible();
  await expect(page.getByText('Крестовина жесткости')).toBeVisible();
  await expect(page.getByText('Только для секции шириной 1000 мм')).toBeVisible();
  await expect(page.getByText('Металлический подпятник', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Уголки жесткости на полки')).toHaveCount(0);

  const priceLocator = page.locator('text=/[\\d\\s]+\\s?₸/').first();
  const priceBefore = await priceLocator.textContent();

  // Check the shelf-reinforcement option — a real, priced accessory.
  const ribCheckbox = page.getByRole('checkbox', { name: 'Ребро жесткости в каждую полку', exact: true });
  await ribCheckbox.check();
  await expect.poll(() => priceLocator.textContent(), { timeout: 10_000 }).not.toBe(priceBefore);
  await expect(ribCheckbox).toBeChecked();

  await page.reload();
  await openAdvancedSettings(page);
  const ribAfterReload = page.getByRole('checkbox', { name: 'Ребро жесткости в каждую полку', exact: true });
  await expect(ribAfterReload).toBeChecked();
});

test('cross brace is only selectable for a 1000mm section, and enforced server-side too', async ({ page }) => {
  await page.goto('/ru/configurator');
  await openAdvancedSettings(page);

  const crossBraceCheckbox = page.getByRole('checkbox', { name: /^Крестовина жесткости\./ });

  // Default section is 1000mm — eligible.
  await expect(crossBraceCheckbox).toBeEnabled();
  await crossBraceCheckbox.check();
  await expect(crossBraceCheckbox).toBeChecked();

  // Resize the active section away from 1000mm — the option must disable
  // and the now-invalid selection must clear itself (not just grey out
  // while still silently "on").
  const widthSelect = page.locator('select[aria-label="Ширина секции 1"]');
  await widthSelect.selectOption('1200');
  await expect(crossBraceCheckbox).toBeDisabled();
  await expect(crossBraceCheckbox).not.toBeChecked();

  // A request crafted to bypass the UI (simulating untrusted client input)
  // must still be rejected — the restriction is authoritative server-side,
  // not just a disabled checkbox.
  const response = await page.request.post('/api/pricing/calculate', {
    data: {
      modelSlug: 'ms-standard',
      depth: 400,
      sections: [{ id: 's1', width: 1200, height: 2000, shelves: 5, rearWall: false, leftWall: false, rightWall: false }],
      loadCapacity: 150,
      shelfType: 'STANDARD',
      colorId: 'color-grey',
      accessories: [{ accessoryId: 'acc-cross-brace', quantity: 1, sectionId: 's1' }],
      assemblyId: 'assembly-self',
      deliveryId: 'delivery-pickup',
      quantity: 1,
    },
  });
  const body = await response.json();
  expect(body.ok).toBe(false);
  expect(body.code).toBe('INCOMPATIBLE_CONFIGURATION');
});

test('a legacy persisted non-STANDARD shelf type normalizes to STANDARD without a pricing error', async ({ page }) => {
  await page.goto('/ru/configurator');
  await page.evaluate(() => {
    localStorage.setItem(
      'ms-shelving-configurator',
      JSON.stringify({
        state: {
          config: {
            modelSlug: 'ms-standard',
            height: 2000,
            depth: 400,
            shelves: 5,
            sections: [{ id: 'legacy-1', width: 1000, rearWall: false, leftWall: false, rightWall: false }],
            loadCapacity: 150,
            shelfType: 'PERFORATED',
            colorId: 'color-grey',
            accessories: [],
            assemblyId: 'assembly-self',
            deliveryId: 'delivery-pickup',
            quantity: 1,
          },
          activeSectionId: 'legacy-1',
        },
        version: 2,
      }),
    );
  });
  await page.reload();

  await expect.poll(
    async () => {
      return (await storedActiveConfiguration(page))?.shelfType ?? null;
    },
    { timeout: 10_000 },
  ).toBe('STANDARD');

  const priceLocator = page.locator('text=/[\\d\\s]+\\s?₸/').first();
  await expect(priceLocator).toBeVisible();
  await expect(page.getByText(/недоступен/)).toHaveCount(0);
});
