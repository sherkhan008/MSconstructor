import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end coverage for the authoritative MS Standard configuration
 * matrix (see src/lib/pricing/ms-standard-compatibility.ts): the depth
 * select must only ever offer depths valid for every current section's
 * width, the width select must only offer widths valid for the current
 * depth, the height select must only offer heights whose own shelf
 * ceiling fits the current shelf count, and the shelf stepper's own
 * maximum must follow the current height. Every case here is one of the
 * task's own explicit examples.
 */

// Not page.getByLabel(...): the resize handle's own aria-label ("Изменить
// высоту стеллажа. Текущая высота: ... миллиметров.") contains "высота" as
// a substring too, which getByLabel's default substring matching also
// picks up — scoping to the wrapping <label> instead reliably finds only
// the <select>.
function depthSelect(page: Page) {
  return page.locator('label:has-text("Глубина") select');
}
function heightSelect(page: Page) {
  return page.locator('label:has-text("Высота") select');
}
function widthSelect(page: Page, sectionIndex = 1) {
  return page.locator(`select[aria-label="Ширина секции ${sectionIndex}"]`);
}

async function optionValues(select: ReturnType<typeof depthSelect>): Promise<string[]> {
  return select.locator('option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
}

async function gotoConfig(
  page: Page,
  { height = 2000, depth = 400, shelves = 5, sections = '1000:false:false:false' }: { height?: number; depth?: number; shelves?: number; sections?: string } = {},
) {
  await page.goto(`/configurator?model=ms-standard&height=${height}&depth=${depth}&shelves=${shelves}&sections=${sections}`);
  await expect(widthSelect(page)).toBeVisible();
}

test.describe('depth select is filtered by section width (task §28-31)', () => {
  test('width 700: 300/400/500/600/800, never 700', async ({ page }) => {
    await gotoConfig(page, { depth: 300, sections: '700:false:false:false' });
    expect(await optionValues(depthSelect(page))).toEqual(['300', '400', '500', '600', '800']);
  });

  test('width 1000: all six depths', async ({ page }) => {
    await gotoConfig(page, { depth: 400, sections: '1000:false:false:false' });
    expect(await optionValues(depthSelect(page))).toEqual(['300', '400', '500', '600', '700', '800']);
  });

  test('width 1200: 300/400/500/600 only', async ({ page }) => {
    await gotoConfig(page, { depth: 400, sections: '1200:false:false:false' });
    expect(await optionValues(depthSelect(page))).toEqual(['300', '400', '500', '600']);
  });

  test('width 1500: 300/400/500/600 only', async ({ page }) => {
    await gotoConfig(page, { depth: 400, sections: '1500:false:false:false' });
    expect(await optionValues(depthSelect(page))).toEqual(['300', '400', '500', '600']);
  });
});

test.describe('width select is filtered by global depth (task §32-33)', () => {
  test('depth 700: width 1000 ONLY', async ({ page }) => {
    await gotoConfig(page, { depth: 700, sections: '1000:false:false:false' });
    expect(await optionValues(widthSelect(page))).toEqual(['1000']);
  });

  test('depth 800: 700 and 1000 only, not 1200/1500', async ({ page }) => {
    await gotoConfig(page, { depth: 800, sections: '1000:false:false:false' });
    expect(await optionValues(widthSelect(page))).toEqual(['700', '1000']);
  });

  test('depth 300/400/500/600: all four widths', async ({ page }) => {
    for (const depth of [300, 400, 500, 600]) {
      await gotoConfig(page, { depth, sections: '1000:false:false:false' });
      expect(await optionValues(widthSelect(page))).toEqual(['700', '1000', '1200', '1500']);
    }
  });
});

test.describe('multi-section depth intersection (task §35)', () => {
  test('1000 + 1200: 300/400/500/600', async ({ page }) => {
    await gotoConfig(page, { depth: 400, sections: '1000:false:false:false,1200:false:false:false' });
    expect(await optionValues(depthSelect(page))).toEqual(['300', '400', '500', '600']);
  });

  test('700 + 1000: 300/400/500/600/800, never 700', async ({ page }) => {
    await gotoConfig(page, { depth: 400, sections: '700:false:false:false,1000:false:false:false' });
    expect(await optionValues(depthSelect(page))).toEqual(['300', '400', '500', '600', '800']);
  });

  test('1200 + 1500: 300/400/500/600', async ({ page }) => {
    await gotoConfig(page, { depth: 400, sections: '1200:false:false:false,1500:false:false:false' });
    expect(await optionValues(depthSelect(page))).toEqual(['300', '400', '500', '600']);
  });
});

test.describe('height/shelf cross-limits (task §34)', () => {
  test('height 1500: shelf stepper stops at 6, cannot reach 7 or 8', async ({ page }) => {
    await gotoConfig(page, { height: 1500, shelves: 6 });
    const increase = page.getByRole('button', { name: 'Увеличить', exact: true });
    await expect(increase).toBeDisabled();
    const shelvesValue = page.getByTestId('shelf-count');
    await expect(shelvesValue).toHaveText('6');
  });

  test('height 1800: shelf stepper also stops at 6', async ({ page }) => {
    await gotoConfig(page, { height: 1800, shelves: 6 });
    await expect(page.getByRole('button', { name: 'Увеличить', exact: true })).toBeDisabled();
  });

  test('height 2000/2200/2500/3000: shelf stepper reaches 8', async ({ page }) => {
    for (const height of [2000, 2200, 2500, 3000]) {
      await gotoConfig(page, { height, shelves: 8 });
      await expect(page.getByRole('button', { name: 'Увеличить', exact: true })).toBeDisabled();
      const shelvesValue = page.getByTestId('shelf-count');
      await expect(shelvesValue).toHaveText('8');
    }
  });

  test('at shelves=8, the height select does not offer 1500 or 1800', async ({ page }) => {
    await gotoConfig(page, { height: 2000, shelves: 8 });
    const values = await optionValues(heightSelect(page));
    expect(values).not.toContain('1500');
    expect(values).not.toContain('1800');
    expect(values).toEqual(['2000', '2200', '2500', '3000']);
  });

  test('at shelves<=6, the height select offers all six heights', async ({ page }) => {
    await gotoConfig(page, { height: 2000, shelves: 6 });
    expect(await optionValues(heightSelect(page))).toEqual(['1500', '1800', '2000', '2200', '2500', '3000']);
  });
});

test.describe('obsolete heights never appear (task §36)', () => {
  test('the height select contains none of the old heights', async ({ page }) => {
    await gotoConfig(page);
    const values = await optionValues(heightSelect(page));
    for (const obsolete of ['500', '1000', '1200', '2300', '2400']) {
      expect(values).not.toContain(obsolete);
    }
  });

  test('a share link with an obsolete height (2400) is normalized on load, not left broken', async ({ page }) => {
    await gotoConfig(page, { height: 2400, shelves: 8 });
    // 2400 is nearer to 2500 than 2200 — see nearestValidMsStandardHeight.
    await expect(heightSelect(page)).toHaveValue('2500');
    // 2500's own shelf ceiling (8) keeps the requested 8 shelves valid.
    const shelvesValue = page.getByTestId('shelf-count');
    await expect(shelvesValue).toHaveText('8');
  });

  test('a share link with an obsolete height (1200) normalizes to 1500 and clamps shelves to 6', async ({ page }) => {
    await gotoConfig(page, { height: 1200, shelves: 8 });
    await expect(heightSelect(page)).toHaveValue('1500');
    const shelvesValue = page.getByTestId('shelf-count');
    await expect(shelvesValue).toHaveText('6');
  });
});

test.describe('depth normalization on an incompatible share link', () => {
  test('width 1200 + depth 800 (invalid) normalizes depth to 600, keeps width 1200', async ({ page }) => {
    await gotoConfig(page, { depth: 800, sections: '1200:false:false:false' });
    await expect(widthSelect(page)).toHaveValue('1200');
    await expect(depthSelect(page)).toHaveValue('600');
  });

  test('width 700 + depth 700 (invalid) normalizes depth to 600 (tie-break smaller), keeps width 700', async ({ page }) => {
    await gotoConfig(page, { depth: 700, sections: '700:false:false:false' });
    await expect(widthSelect(page)).toHaveValue('700');
    await expect(depthSelect(page)).toHaveValue('600');
  });
});
