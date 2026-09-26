import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { sectionButtons, selectSection } from './helpers/sections';
import { configurationToShareQuery } from '../../src/lib/configurator/url';
import type { SectionCorner, ShelvingConfiguration, ShelvingSection } from '../../src/lib/types/domain';

/**
 * Smallest supported phone (320 px) — the two pre-launch preview defects:
 *
 *  1. With five sections (or a corner's narrow front) the on-rack "+"/"−"
 *     pairs sat closer than one touch target, so neighbouring controls
 *     touched and their hit areas covered each other's discs. They are now
 *     left out while that crowded, and the full-size controls in the section
 *     list below the preview do the job.
 *  2. A LEFT corner's outward width label ("↗ 1000") was drawn 0–4 px from
 *     the screen edge and read as cut off. It now keeps clear of the edge or
 *     is left out (the section list always states the width).
 *
 * The geometry, scale and prices are unchanged, and a Pixel 7 / desktop
 * frame that has the room keeps its on-rack controls.
 */

const section = (i: number, width = 1000, corner: SectionCorner = 'NONE'): ShelvingSection => ({
  id: `s${i}`,
  width,
  height: 2000,
  shelves: 5,
  rearWall: false,
  leftWall: false,
  rightWall: false,
  corner,
});

const kit = (sections: ShelvingSection[], depth = 400): ShelvingConfiguration => ({
  modelSlug: 'ms-standard',
  depth,
  sections,
  loadCapacity: 150,
  shelfType: 'STANDARD',
  colorId: 'color-grey',
  accessories: [],
  assemblyId: 'assembly-self',
  deliveryId: 'delivery-pickup',
  quantity: 1,
});

const FIVE = kit([0, 1, 2, 3, 4].map((i) => section(i)));
const LEFT_PLUS_FOUR = kit([section(0, 1000, 'LEFT'), ...[1, 2, 3, 4].map((i) => section(i))]);
const LEFT_PLUS_THREE = kit([section(0, 1000, 'LEFT'), ...[1, 2, 3].map((i) => section(i))]);
const LEFT_PLUS_THREE_SHALLOW = kit([section(0, 1000, 'LEFT'), ...[1, 2, 3].map((i) => section(i))], 300);
const LEFT_PLUS_FOUR_NARROW = kit([section(0, 700, 'LEFT'), ...[1, 2, 3, 4].map((i) => section(i))], 300);

async function open(page: Page, config: ShelvingConfiguration, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`/ru/configurator?${configurationToShareQuery(config)}`);
  await expect(page.getByRole('button', { name: /^Добавить (все )?в корзину$/ })).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('preview-stage').scrollIntoViewIfNeeded();
}

/** Every on-rack section "+"/"−" in the preview, with its hit area and visible disc. */
async function onRackSectionControls(page: Page) {
  return page.getByTestId('preview-stage').locator('..').evaluate((frame) =>
    [...frame.querySelectorAll<HTMLButtonElement>('button[aria-label^="Добавить секцию после"], button[aria-label^="Удалить секцию "], button[aria-label^="Добавить секцию перед"]')]
      .filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) => {
        const hit = b.getBoundingClientRect();
        const disc = b.querySelector('span')!.getBoundingClientRect();
        return { hit: { l: hit.left, r: hit.right, t: hit.top, b: hit.bottom }, disc: { l: disc.left, r: disc.right, t: disc.top, b: disc.bottom } };
      }),
  );
}

type Box = { l: number; r: number; t: number; b: number };
const overlaps = (a: Box, b: Box) => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;

for (const [name, config] of [
  ['five sections', FIVE],
  ['a LEFT corner and four sections', LEFT_PLUS_FOUR],
] as const) {
  test(`320px, ${name}: no on-rack section control touches or covers another; the section list keeps full-size controls`, async ({ page }) => {
    await open(page, config, 320);
    const controls = await onRackSectionControls(page);
    // No neighbour's 44 px hit area reaches another control's visible disc.
    for (let i = 0; i < controls.length; i += 1)
      for (let j = 0; j < controls.length; j += 1)
        if (i !== j) expect(overlaps(controls[i].hit, controls[j].disc), `control ${i} covers disc ${j}`).toBe(false);

    // The section list below still reaches and removes every section with
    // full-size targets: select its row, then its own remove button.
    const remove = page.getByRole('button', { name: 'Удалить секцию', exact: true });
    for (let n = 1; n <= 5; n += 1) {
      await selectSection(page, n);
      await expect(remove).toBeEnabled();
      const box = (await remove.boundingBox())!;
      expect(Math.min(box.width, box.height), `remove section ${n}`).toBeGreaterThanOrEqual(44);
    }
    await selectSection(page, 3);
    await remove.click();
    await expect(sectionButtons(page)).toHaveCount(4);
    // The active section's shelf-count column stays on the rack.
    await expect(page.getByTestId('preview-shelf-controls')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test('320px: a LEFT corner width label is never drawn against the screen edge', async ({ page }) => {
  for (const config of [LEFT_PLUS_THREE, LEFT_PLUS_THREE_SHALLOW, LEFT_PLUS_FOUR, LEFT_PLUS_FOUR_NARROW]) {
    await open(page, config, 320);
    const label = await page.getByTestId('preview-stage').evaluate((stage) => {
      const frame = stage.parentElement!.getBoundingClientRect();
      const text = [...stage.querySelectorAll('svg text')].find((t) => t.textContent?.startsWith('↗'));
      if (!text) return null;
      const box = text.getBoundingClientRect();
      return { gapLeft: box.left - Math.max(0, frame.left), right: box.right, frameRight: frame.right };
    });
    // Either left out (the section list states the width) or fully inside,
    // clear of the edge.
    if (label) {
      expect(label.gapLeft).toBeGreaterThanOrEqual(4.5);
      expect(label.right).toBeLessThanOrEqual(label.frameRight);
    }
    // The corner's width is always stated in the section list.
    await expect(page.getByRole('combobox', { name: 'Ширина секции 1' })).toHaveValue(String(config.sections[0].width));
  }
});

test('where there is room (Pixel 7 width, desktop) the on-rack section controls stay', async ({ page }) => {
  for (const [config, width, expected] of [
    [FIVE, 412, 10],
    [FIVE, 1280, 10],
    [LEFT_PLUS_FOUR, 1280, 10],
  ] as const) {
    await open(page, config, width);
    const controls = await onRackSectionControls(page);
    expect(controls, `${config.sections.length} sections at ${width}px`).toHaveLength(expected);
  }
});
