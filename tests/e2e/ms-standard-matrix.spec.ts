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
  test('height 1000: shelf stepper stops at 4, cannot reach 5', async ({ page }) => {
    await gotoConfig(page, { height: 1000, shelves: 4 });
    await expect(page.getByRole('button', { name: '\u0423\u0432\u0435\u043b\u0438\u0447\u0438\u0442\u044c', exact: true })).toBeDisabled();
    await expect(page.getByTestId('shelf-count')).toHaveText('4');
  });

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

  test('at shelves=5 or 6, the height select offers every height except 1000', async ({ page }) => {
    for (const shelves of [5, 6]) {
      await gotoConfig(page, { height: 2000, shelves });
      const values = await optionValues(heightSelect(page));
      expect(values).not.toContain('1000');
      expect(values).toEqual(['1500', '1800', '2000', '2200', '2500', '3000']);
    }
  });

  test('at shelves<=4, the height select offers all seven heights, 1000 first and in numeric order', async ({ page }) => {
    await gotoConfig(page, { height: 2000, shelves: 4 });
    expect(await optionValues(heightSelect(page))).toEqual(['1000', '1500', '1800', '2000', '2200', '2500', '3000']);
  });
});

test.describe('height 1000 is a real, selectable MS Standard height', () => {
  test('a share link at height 1000 stays at 1000 and is never normalized up to 1500', async ({ page }) => {
    await gotoConfig(page, { height: 1000, shelves: 3 });
    await expect(heightSelect(page)).toHaveValue('1000');
    await expect(page.getByTestId('shelf-count')).toHaveText('3');
  });

  test('a share link at height 1000 with 8 shelves clamps the shelves to 4, keeping the height', async ({ page }) => {
    await gotoConfig(page, { height: 1000, shelves: 8 });
    await expect(heightSelect(page)).toHaveValue('1000');
    await expect(page.getByTestId('shelf-count')).toHaveText('4');
  });

  test('persisted state at height 1000 survives a reload unchanged', async ({ page }) => {
    // Arrive via a share link, then reload with no query at all: what comes
    // back is the persisted (localStorage) configuration, which must not
    // normalize 1000 away the way it did while 1000 was invalid.
    await gotoConfig(page, { height: 1000, shelves: 4, depth: 700 });
    await expect(heightSelect(page)).toHaveValue('1000');

    await page.goto('/configurator');
    await expect(widthSelect(page)).toBeVisible();
    await expect(heightSelect(page)).toHaveValue('1000');
    await expect(depthSelect(page)).toHaveValue('700');
    await expect(page.getByTestId('shelf-count')).toHaveText('4');
  });

  test('height 1000 imposes no depth restriction: 1000-wide section still offers all six depths', async ({ page }) => {
    await gotoConfig(page, { height: 1000, shelves: 4, depth: 400 });
    expect(await optionValues(depthSelect(page))).toEqual(['300', '400', '500', '600', '700', '800']);
  });

  test('height 1000 imposes no width restriction: depth 400 still offers all four widths', async ({ page }) => {
    await gotoConfig(page, { height: 1000, shelves: 4, depth: 400 });
    expect(await optionValues(widthSelect(page))).toEqual(['700', '1000', '1200', '1500']);
  });

  // The height drag handle takes its allowed values from the very same
  // getAllowedHeightsForShelfCount the select uses (see ConfiguratorClient's
  // allowedDimensions), so its announced range is the observable proof that
  // drag and select cannot drift apart.
  test('the height drag handle exposes 1000 as its lowest target when shelves <= 4', async ({ page }) => {
    await gotoConfig(page, { height: 2000, shelves: 4 });
    await expect(page.locator('button[data-axis="height"]')).toHaveAttribute('aria-valuemin', '1000');
  });

  test('the height drag handle does NOT expose 1000 when shelves > 4', async ({ page }) => {
    for (const [shelves, expectedMin] of [[5, '1500'], [6, '1500'], [8, '2000']] as const) {
      await gotoConfig(page, { height: 2000, shelves });
      await expect(page.locator('button[data-axis="height"]')).toHaveAttribute('aria-valuemin', expectedMin);
    }
  });

  test('keyboard-stepping the height handle down from 1500 lands on 1000 and commits it', async ({ page }) => {
    await gotoConfig(page, { height: 1500, shelves: 4 });
    const heightHandle = page.locator('button[data-axis="height"]');
    await heightHandle.focus();
    await heightHandle.press('ArrowDown');
    // One commit, one settled value — no lost update, no bounce back to 1500.
    await expect(heightHandle).toHaveAttribute('aria-valuenow', '1000');
    await expect(heightSelect(page)).toHaveValue('1000');
    await page.waitForTimeout(500);
    await expect(heightHandle).toHaveAttribute('aria-valuenow', '1000');
  });

  test('a real server price is shown at height 1000 (it prices end to end)', async ({ page }) => {
    await gotoConfig(page, { height: 1000, shelves: 4 });
    // Same locator the other configurator specs use for "the server returned
    // a real total" \u2014 the page renders no price at all when pricing fails.
    await expect(page.locator('text=/[\\d\\s]+\\s?\u20b8/').first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('obsolete heights never appear (task §36)', () => {
  test('the height select contains none of the old heights', async ({ page }) => {
    await gotoConfig(page);
    const values = await optionValues(heightSelect(page));
    // 1000 is deliberately not in this list any more - it is a real height.
    for (const obsolete of ['500', '1200', '2300', '2400']) {
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

  test('a share link with an obsolete height (1200) normalizes to 1000 (now the nearest) and clamps shelves to 4', async ({ page }) => {
    await gotoConfig(page, { height: 1200, shelves: 8 });
    await expect(heightSelect(page)).toHaveValue('1000');
    const shelvesValue = page.getByTestId('shelf-count');
    await expect(shelvesValue).toHaveText('4');
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
