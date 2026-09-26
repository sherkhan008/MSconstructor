import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';

/**
 * Configurator V2.3 — true physical geometry, measured in the real browser:
 * every section drawn from its own width, height and shelf count at one
 * uniform scale on one floor, the whole rack inside the frame, no horizontal
 * page scroll, and drags whose dragged edge stays under the pointer with no
 * rescale during the gesture or at its commit.
 */

const MIXED: Record<string, { query: string; sections: { width: number; height: number; shelves: number }[] }> = {
  'two sections, 1000×1500/4 + 1200×2500/8': {
    query: '?v=2&model=ms-standard&depth=400&sections=1000:1500:4:0:0:0,1200:2500:8:0:0:0',
    sections: [
      { width: 1000, height: 1500, shelves: 4 },
      { width: 1200, height: 2500, shelves: 8 },
    ],
  },
  'two sections, 700×1000/2 + 1500×3000/8': {
    query: '?v=2&model=ms-standard&depth=400&sections=700:1000:2:0:0:0,1500:3000:8:0:0:0',
    sections: [
      { width: 700, height: 1000, shelves: 2 },
      { width: 1500, height: 3000, shelves: 8 },
    ],
  },
  'five mixed sections': {
    query:
      '?v=2&model=ms-standard&depth=400&sections=700:1000:2:0:0:0,1000:1500:4:1:0:0,1200:2000:6:0:1:0,1500:2500:8:0:0:0,1000:3000:5:0:0:1',
    sections: [
      { width: 700, height: 1000, shelves: 2 },
      { width: 1000, height: 1500, shelves: 4 },
      { width: 1200, height: 2000, shelves: 6 },
      { width: 1500, height: 2500, shelves: 8 },
      { width: 1000, height: 3000, shelves: 5 },
    ],
  },
};

/** Each section's drawn front uprights and shelf lips, in CSS pixels. */
async function measureSections(page: Page, count: number) {
  return page.evaluate((n) => {
    const svg = document.querySelector('[data-testid="preview-stage"] svg')!;
    return Array.from({ length: n }, (_, i) => {
      const posts = Array.from(svg.querySelectorAll(`rect[data-upright="front"][data-section-index="${i}"]`))
        .map((el) => el.getBoundingClientRect())
        .sort((a, b) => a.left - b.left);
      const lips = svg.querySelectorAll(`rect[data-shelf-part="front-lip"][data-section-index="${i}"]`).length;
      return {
        left: posts[0].left,
        right: posts[1].right,
        top: posts[0].top,
        bottom: posts[0].bottom,
        tops: posts.map((p) => p.top),
        bottoms: posts.map((p) => p.bottom),
        lips,
      };
    });
  }, count);
}

/** Every rack part lies inside the visible frame, and the page has no horizontal scroll. */
async function expectRackInsideFrame(page: Page) {
  const result = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="preview-stage"]')!.parentElement!.getBoundingClientRect();
    let outside = 0;
    for (const el of document.querySelectorAll('[data-testid="preview-stage"] svg [data-upright], [data-testid="preview-stage"] svg [data-shelf-part]')) {
      const r = el.getBoundingClientRect();
      if (r.left < frame.left - 0.5 || r.right > frame.right + 0.5 || r.top < frame.top - 0.5 || r.bottom > frame.bottom + 0.5) outside += 1;
    }
    return { outside, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(result).toEqual({ outside: 0, overflow: 0 });
}

async function nextFrame(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

for (const [name, { query, sections }] of Object.entries(MIXED)) {
  test(`mixed geometry renders physically: ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`/ru/configurator${query}`);
    const tallest = Math.max(...sections.map((s) => s.height));
    // The share link is applied one commit after the persisted store renders.
    await expect(page.locator('button[data-axis="height"]')).toHaveAttribute('aria-valuenow', String(tallest));
    await expect(page.locator('select[aria-label^="Ширина секции"]')).toHaveCount(sections.length);

    const measured = await measureSections(page, sections.length);
    const scale = (measured[0].right - measured[0].left) / sections[0].width;
    for (const [i, s] of sections.entries()) {
      const m = measured[i];
      // One uniform scale for every width and every height (sub-pixel tolerance).
      expect(Math.abs((m.right - m.left) - s.width * scale), `section ${i + 1} width`).toBeLessThan(1);
      expect(Math.abs((m.bottom - m.top) - s.height * scale), `section ${i + 1} height`).toBeLessThan(1.5);
      // Its own shelf count.
      expect(m.lips, `section ${i + 1} shelves`).toBe(s.shelves);
      // Both uprights end at its own top.
      expect(Math.abs(m.tops[0] - m.tops[1])).toBeLessThan(0.5);
      // One common floor.
      for (const bottom of m.bottoms) expect(Math.abs(bottom - measured[0].bottoms[0])).toBeLessThan(0.5);
    }
    // A shorter section visibly stops below a taller neighbour.
    for (let i = 1; i < sections.length; i += 1) {
      const diff = sections[i].height - sections[i - 1].height;
      if (diff !== 0) expect(Math.sign(measured[i - 1].top - measured[i].top)).toBe(Math.sign(diff));
    }

    await expectRackInsideFrame(page);
    expect(errors).toEqual([]);
  });
}

test('section selection works on a mixed row: the clicked section becomes active', async ({ page }) => {
  await page.goto(`/ru/configurator${MIXED['five mixed sections'].query}`);
  await expect(page.locator('select[aria-label^="Ширина секции"]')).toHaveCount(5);
  await page.getByRole('button', { name: /^Секция 4, ширина 1500/ }).first().click();
  await expect(page.getByRole('button', { name: 'Секция 4', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // The width handle moves to section 4's own right upright.
  const [s4] = (await measureSections(page, 5)).slice(3, 4);
  const handle = await page.locator('button[data-axis="width"]').boundingBox();
  expect(Math.abs(handle!.x + handle!.width / 2 - s4.right)).toBeLessThan(1.5);
});

test('width drag on a five-section row: the upright follows the pointer 1:1, nothing rescales, release lands on the snapped width', async ({
  page,
}) => {
  // Five sections — the row the scale is width-bound for, i.e. exactly where
  // a width-dependent fit would rescale mid-drag or on release.
  await page.goto('/ru/configurator?v=2&model=ms-standard&depth=400&sections=1000:2000:4:0:0:0,1000:2000:4:0:0:0,700:2000:4:0:0:0,1000:2000:4:0:0:0,1000:2000:4:0:0:0');
  const widthSelects = page.locator('select[aria-label^="Ширина секции"]');
  await expect(widthSelects).toHaveCount(5);
  const section3 = page.getByRole('button', { name: 'Секция 3', exact: true });
  await section3.click();
  await expect(section3).toHaveAttribute('aria-pressed', 'true');

  const stage = page.getByTestId('preview-stage');
  const handle = page.locator('button[data-axis="width"]');
  await handle.scrollIntoViewIfNeeded();
  const stageBefore = await stage.boundingBox();
  const start = (await handle.boundingBox())!;
  const startX = start.x + start.width / 2;
  const startY = start.y + start.height / 2;
  const before = await measureSections(page, 5);
  const pxPerMm = (before[2].right - before[2].left) / 700;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 700 → 1500 is 800 mm of travel; stay well inside it so nothing clamps.
  const maxTravel = Math.floor(700 * pxPerMm);
  const steps = [0.2, 0.4, 0.6, 0.8].map((f) => Math.round(maxTravel * f));
  for (const dx of steps) {
    await page.mouse.move(startX + dx, startY);
    await nextFrame(page);
    const live = (await handle.boundingBox())!;
    // The dragged upright (and its handle) moves exactly as far as the pointer.
    expect(Math.abs(live.x + live.width / 2 - (startX + dx)), `pointer +${dx}px`).toBeLessThan(1.5);
    // Sections before the active one never move; the stage never rescales.
    const now = await measureSections(page, 5);
    for (const i of [0, 1]) expect(Math.abs(now[i].right - before[i].right)).toBeLessThan(0.5);
    expect(Math.abs(now[0].bottom - before[0].bottom)).toBeLessThan(0.5);
    expect(await stage.boundingBox()).toEqual(stageBefore);
  }
  const lastDx = steps[steps.length - 1];
  const liveMm = 700 + lastDx / pxPerMm;
  await page.mouse.up();

  const committed = Number(await widthSelects.nth(2).inputValue());
  expect([1000, 1200, 1500]).toContain(committed);
  await nextFrame(page);
  const released = (await handle.boundingBox())!;
  // After release the upright sits exactly at the snapped width, at the same
  // scale — the only movement is the snap distance itself.
  expect(Math.abs(released.x + released.width / 2 - (startX + lastDx) - (committed - liveMm) * pxPerMm)).toBeLessThan(1.5);
  expect(await stage.boundingBox()).toEqual(stageBefore);
  // The other sections kept their widths.
  for (const i of [0, 1, 3, 4]) await expect(widthSelects.nth(i)).toHaveValue('1000');
});

test('height drag on a mixed row: the top edge follows the pointer 1:1 without rescaling, then commits once', async ({ page }) => {
  await page.goto(`/ru/configurator${MIXED['two sections, 1000×1500/4 + 1200×2500/8'].query}`);
  const heightHandle = page.locator('button[data-axis="height"]');
  await expect(heightHandle).toHaveAttribute('aria-valuenow', '2500');

  const stage = page.getByTestId('preview-stage');
  await heightHandle.scrollIntoViewIfNeeded();
  const stageBefore = await stage.boundingBox();
  const before = await measureSections(page, 2);
  const pxPerMm = (before[1].bottom - before[1].top) / 2500;
  const start = (await heightHandle.boundingBox())!;
  const startX = start.x + start.width / 2;
  const startY = start.y + start.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 2500 → 3000 is 500 mm of headroom; stay inside it.
  const maxTravel = Math.floor(450 * pxPerMm);
  const steps = [0.25, 0.5, 0.75, 1].map((f) => Math.round(maxTravel * f));
  for (const dy of steps) {
    await page.mouse.move(startX, startY - dy);
    await nextFrame(page);
    const live = (await heightHandle.boundingBox())!;
    // Vertically 1:1 with the pointer, and never sliding sideways.
    expect(Math.abs(live.y + live.height / 2 - (startY - dy)), `pointer -${dy}px`).toBeLessThan(1.5);
    expect(Math.abs(live.x - start.x)).toBeLessThan(0.5);
    expect(await stage.boundingBox()).toEqual(stageBefore);
  }
  await page.mouse.up();

  // The transitional control applies the snapped height to every section.
  await expect(heightHandle).toHaveAttribute('aria-valuenow', '3000');
  await nextFrame(page);
  const after = await measureSections(page, 2);
  for (const m of after) expect(Math.abs(m.bottom - m.top - 3000 * pxPerMm)).toBeLessThan(1.5);
  expect(await stage.boundingBox()).toEqual(stageBefore);
});
