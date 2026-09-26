import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { sectionButtons, storedSections, storedWidths } from './helpers/sections';

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

/**
 * Finds a point within a resize zone's own bounding box, along one axis,
 * whose topmost element really is that zone — not a different, legitimate
 * control that happens to float over the same region on a small viewport
 * (the height handle sits near the row's left edge, each section's own
 * "add" button sits at its horizontal centre, the shelf-count column sits
 * just past the row's right edge — all by design, all real controls this
 * test must not accidentally drive instead). Tries each candidate fraction
 * in order and returns the first one whose topmost element is the zone
 * itself, so a test can reliably land inside a described region (e.g.
 * "somewhere in the first third") without hardcoding viewport-specific
 * pixel math.
 */
async function findClearPointInZone(
  page: Page,
  zoneBox: { x: number; y: number; width: number; height: number },
  axis: 'x' | 'y',
  fractions: number[],
  testId: string,
): Promise<{ x: number; y: number }> {
  for (const fraction of fractions) {
    const x = axis === 'x' ? zoneBox.x + zoneBox.width * fraction : zoneBox.x + zoneBox.width / 2;
    const y = axis === 'y' ? zoneBox.y + zoneBox.height * fraction : zoneBox.y + zoneBox.height / 2;
    const isZone = await page.evaluate(
      ([px, py, expectedTestId]) => document.elementFromPoint(px as number, py as number)?.getAttribute('data-testid') === expectedTestId,
      [x, y, testId] as const,
    );
    if (isZone) return { x, y };
  }
  throw new Error(`No clear point found in zone [data-testid="${testId}"] among fractions ${fractions.join(', ')}`);
}

test('drag-to-resize: width handle updates the active section, recalculates price, and survives reload', async ({ page }) => {
  await page.goto('/ru/configurator');

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

/**
 * Enlarged hit-area coverage: dragging must be startable from anywhere
 * along the full height of the right front upright / the full width of the
 * top rack edge, not only from the small circular ResizeHandle button. Both
 * the button and these zones call the exact same widthDrag/heightDrag
 * handlers (see ShelvingPreview's "5b. Resize zones" comment) — this proves
 * the zone is itself a real, independent drag entry point, by deliberately
 * never touching `button[data-axis="..."]` as the drag origin.
 */
test('width resize can start from near the top or near the bottom of the right upright — not only the circular button', async ({
  page,
}) => {
  // Two sections so the *first* section's own width-resize zone sits at an
  // interior shared boundary, not the row's far-right edge — the row-level
  // shelf-count +/- column is anchored just past that far-right edge and
  // would otherwise cover most of a single section's own zone on a narrow
  // viewport. This also doubles as multi-section hit-area coverage.
  //
  // Only two regions, not three: the width ResizeHandle button itself is
  // centred on the zone and, on a narrow/mobile viewport, its own footprint
  // covers roughly the zone's middle 20%-75% — there is no non-button point
  // near the literal centre to test there. Near-top and near-bottom are
  // still two distinct, well-separated points clearly outside the button,
  // which is what actually proves the enlarged zone (not just the marker)
  // owns the drag.
  const regions: [number, number][] = [
    [0.05, 0.3], // near the top of the upright
    [0.7, 0.95], // near the bottom
  ];
  for (const [regionStart, regionEnd] of regions) {
    // The configurator store persists to localStorage — a plain goto()
    // would carry over whatever a previous iteration committed, not the
    // default. An explicit share-link URL (see url.ts) deterministically
    // re-seeds the store on every load regardless of what's persisted, so
    // every iteration starts from the same known 1000mm baseline.
    await page.goto(
      '/ru/configurator?v=2&model=ms-standard&depth=400&sections=1000:2000:3:0:0:0,1000:2000:3:0:0:0',
    );
    await expect(sectionButtons(page)).toHaveCount(2);
    await expect.poll(() => storedWidths(page)).toEqual([1000, 1000]);

    const zone = page.getByTestId('width-resize-zone').first();
    await expect(zone).toBeVisible();
    const zoneBox = await zone.boundingBox();
    if (!zoneBox) throw new Error('Width resize zone has no bounding box');
    const fractions = Array.from({ length: 6 }, (_, i) => regionStart + (i * (regionEnd - regionStart)) / 5);
    const { x, y } = await findClearPointInZone(page, zoneBox, 'y', fractions, 'width-resize-zone');

    await page.mouse.move(x, y);
    await page.mouse.down();
    // A real, multi-step drag — not a click — confirms smooth continuous
    // tracking, not just a single discrete pointerdown+up.
    await page.mouse.move(x + 300, y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => (await storedWidths(page))[0]).not.toBe(1000);
    const [after, second] = await storedWidths(page);
    expect([700, 1200, 1500]).toContain(after);
    // The second section, sharing this boundary, must stay untouched.
    expect(second).toBe(1000);
  }
});

test('width resize started from the upright hit-zone still clamps correctly at the 700 and 1500 boundaries', async ({ page }) => {
  await page.goto('/ru/configurator');

  const widthSelect = firstSectionWidthSelect(page);
  const zone = page.getByTestId('width-resize-zone');
  const zoneBox = await zone.boundingBox();
  if (!zoneBox) throw new Error('Width resize zone has no bounding box');
  const zoneX = zoneBox.x + zoneBox.width / 2;
  const zoneY = zoneBox.y + zoneBox.height * 0.5;

  // Drag far right, well past the legal maximum, starting from the zone
  // (not the button) — must clamp to exactly 1500 with no overshoot.
  await page.mouse.move(zoneX, zoneY);
  await page.mouse.down();
  await page.mouse.move(zoneX + 260, zoneY, { steps: 20 });
  await page.mouse.up();
  await expect(widthSelect).toHaveValue('1500');

  // From 1500, drag far left, well past the legal minimum — must clamp to
  // exactly 700.
  const zoneAfterGrow = page.getByTestId('width-resize-zone');
  const boxAfterGrow = await zoneAfterGrow.boundingBox();
  if (!boxAfterGrow) throw new Error('Width resize zone has no bounding box');
  await page.mouse.move(boxAfterGrow.x + boxAfterGrow.width / 2, boxAfterGrow.y + boxAfterGrow.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(boxAfterGrow.x - 260, boxAfterGrow.y + boxAfterGrow.height * 0.5, { steps: 20 });
  await page.mouse.up();
  await expect(widthSelect).toHaveValue('700');
});

test('height resize can start from each section’s own top edge — not only the circular button — and changes only that section', async ({ page }) => {
  // The top strips legitimately host other real controls too — the height
  // handle itself sits near the active section's left edge, and each
  // section's own "add" button sits at its horizontal centre — so rather
  // than assuming literal points are free of them, search each region of a
  // strip for a point the zone itself actually owns (see
  // findClearPointInZone). V2.4: every section has its own strip, and
  // pressing a strip resizes THAT section (selecting it first when needed).
  const regions: [number, number, number][] = [
    [0, 0.05, 0.3], // section 1 (already active), near its left end
    [1, 0.05, 0.3], // section 2 (not active yet), left part of its edge
    [1, 0.7, 0.98], // section 2, right part of its edge
  ];
  for (const [sectionIndex, regionStart, regionEnd] of regions) {
    // The configurator store persists to localStorage — a plain goto()
    // would carry over whatever a previous iteration committed, not the
    // default. An explicit share-link URL (see url.ts) deterministically
    // re-seeds the store on every load regardless of what's persisted, so
    // every iteration starts from the same known baseline height.
    //
    // Two sections, not one: drawn at true physical scale (V2.3) a single
    // 1000mm section's top edge is only about as wide as its own centred
    // "add" button plus the height handle, leaving no point in its middle
    // third that the zone itself owns. A two-section row gives the strip
    // three genuinely distinct free regions again.
    await page.goto('/ru/configurator?v=2&model=ms-standard&depth=400&sections=1000:2000:3:0:0:0,1000:2000:3:0:0:0');
    const heightHandle = page.locator('button[data-axis="height"]');
    // The persisted store renders first and the share link is applied one
    // commit later, so an immediate read can still see the previous
    // iteration's committed heights. Wait for the URL's before dragging.
    await expect(heightHandle).toHaveAttribute('aria-valuenow', '2000');
    await expect.poll(async () => (await storedSections(page)).map((s) => s.height)).toEqual([2000, 2000]);

    const zone = page.locator(`[data-testid="height-resize-zone"][data-section-index="${sectionIndex}"]`);
    await expect(zone).toBeVisible();
    const zoneBox = await zone.boundingBox();
    if (!zoneBox) throw new Error('Height resize zone has no bounding box');
    const fractions = Array.from({ length: 6 }, (_, i) => regionStart + (i * (regionEnd - regionStart)) / 5);
    const { x, y } = await findClearPointInZone(page, zoneBox, 'x', fractions, 'height-resize-zone');

    await page.mouse.move(x, y);
    await page.mouse.down();
    // Dragging up increases height (bottom/FLOOR_Y stays fixed) — same
    // convention as the existing keyboard/button height tests.
    await page.mouse.move(x, y - 300, { steps: 10 });
    await page.mouse.up();

    // The pressed section grew; the other one kept its own height.
    await expect.poll(async () => (await storedSections(page))[sectionIndex].height).toBeGreaterThan(2000);
    expect((await storedSections(page))[1 - sectionIndex].height).toBe(2000);
    await expect(heightHandle).not.toHaveAttribute('aria-valuenow', '2000');
  }
});

test('drag-to-resize: keyboard stepping is a fully usable alternative to dragging', async ({ page }) => {
  await page.goto('/ru/configurator');

  const widthHandle = page.locator('button[data-axis="width"]');
  await expect(widthHandle).toBeVisible();
  await widthHandle.focus();
  await expect(widthHandle).toBeFocused();

  const widthSelect = firstSectionWidthSelect(page);
  await expect(widthSelect).toHaveValue('1000');

  await page.keyboard.press('ArrowRight');
  await expect(widthSelect).toHaveValue('1200');
});

test('drag-to-resize: the height handle changes only the active section (keyboard)', async ({ page }) => {
  await page.goto('/ru/configurator?v=2&model=ms-standard&depth=400&sections=1000:1500:4:0:0:0,1200:2500:8:0:0:0');
  await expect(sectionButtons(page)).toHaveCount(2);

  const heightHandle = page.locator('button[data-axis="height"]');
  await expect(heightHandle).toHaveAttribute('aria-valuenow', '1500');
  await heightHandle.focus();
  await page.keyboard.press('ArrowUp');
  await expect(heightHandle).toHaveAttribute('aria-valuenow', '1800');
  await expect(page.locator('select[aria-label="Высота секции 1"]')).toHaveValue('1800');
  expect((await storedSections(page)).map((s) => s.height)).toEqual([1800, 2500]);
});

/** The inner marker dot's opacity is what actually reveals/hides each
 * handle — the outer 44px button stays present (and clickable/focusable)
 * regardless, which is what keeps keyboard and touch access working. */
async function markerOpacity(page: Page, axis: 'height' | 'width'): Promise<number> {
  const opacity = await page.locator(`button[data-axis="${axis}"] span`).evaluate((el) => getComputedStyle(el).opacity);
  return Number(opacity);
}

test('resize markers stay hidden until the pointer is over their own part of the rack, not just the preview', async ({
  page,
  isMobile,
}) => {
  // This is a hover-discovery concern — touch devices have no hover, so
  // ResizeHandle's pointer-coarse fallback intentionally keeps every marker
  // visible there instead (see requirement 5: "preserve a usable touch
  // alternative"). Nothing to assert on a coarse-pointer project.
  test.skip(isMobile, 'markers are always visible on touch/coarse pointers by design, not hover-gated');

  await page.goto('/ru/configurator');
  const rack = page.getByRole('img', { name: 'Схема стеллажа спереди' });
  await expect(rack).toBeVisible();

  // Idle: nothing revealed.
  expect(await markerOpacity(page, 'height')).toBe(0);
  expect(await markerOpacity(page, 'width')).toBe(0);

  // Hovering an empty corner of the white canvas must not reveal anything —
  // this is the exact regression this task fixes (whole-preview hover reveal).
  const rackBox = await rack.boundingBox();
  if (!rackBox) throw new Error('Rack preview has no bounding box');
  await page.mouse.move(rackBox.x + rackBox.width * 0.85, rackBox.y + rackBox.height * 0.8);
  expect(await markerOpacity(page, 'height')).toBe(0);
  expect(await markerOpacity(page, 'width')).toBe(0);

  // Hovering the height handle's own zone (top of the rack) reveals only height.
  // The "other axis" check uses a tolerant threshold, not a literal 0 —
  // ResizeHandle's opacity is CSS-transitioned, so a marker that was just
  // hidden a moment ago can still read a hair above 0 mid-fade; what matters
  // is that it's nowhere near "revealed" (>0.5), not an exact float value.
  const heightHandle = page.locator('button[data-axis="height"]');
  const hBox = await heightHandle.boundingBox();
  if (!hBox) throw new Error('Height handle has no bounding box');
  await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
  await expect.poll(() => markerOpacity(page, 'height')).toBeGreaterThan(0.5);
  expect(await markerOpacity(page, 'width')).toBeLessThan(0.5);

  // Moving away hides it again.
  await page.mouse.move(rackBox.x + rackBox.width * 0.85, rackBox.y + rackBox.height * 0.8);
  await expect.poll(() => markerOpacity(page, 'height')).toBeLessThan(0.5);

  // Hovering the width handle's own zone (a section's right upright) reveals only width.
  const widthHandle = page.locator('button[data-axis="width"]');
  const wBox = await widthHandle.boundingBox();
  if (!wBox) throw new Error('Width handle has no bounding box');
  await page.mouse.move(wBox.x + wBox.width / 2, wBox.y + wBox.height / 2);
  await expect.poll(() => markerOpacity(page, 'width')).toBeGreaterThan(0.5);
  expect(await markerOpacity(page, 'height')).toBeLessThan(0.5);
});

test('resize markers stay visible mid-drag even after the pointer leaves the original hover zone', async ({ page }) => {
  await page.goto('/ru/configurator');

  const heightHandle = page.locator('button[data-axis="height"]');
  const box = await heightHandle.boundingBox();
  if (!box) throw new Error('Height handle has no bounding box');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Drag far outside the original top-of-rack hover zone.
  await page.mouse.move(startX + 200, startY + 150, { steps: 10 });
  expect(await markerOpacity(page, 'height')).toBeGreaterThan(0.5);
  await page.mouse.up();
});

test('the depth dimension tag is read-only: no depth resize handle or hit-area exists in the preview', async ({ page }) => {
  await page.goto('/ru/configurator');

  // The depth number is still shown as a plain informational tag...
  const depthTag = page.getByTestId('depth-dimension-tag');
  await expect(depthTag).toBeVisible();

  // ...but there is no interactive depth control anywhere in the preview —
  // depth is changed only through the parameter controls below it. Checks
  // both the visible handle button and the (separate, invisible) hover
  // discovery hit-area that used to reveal it, identified by its own
  // distinct resize cursor.
  await expect(page.locator('button[data-axis="depth"]')).toHaveCount(0);
  await expect(page.locator('[style*="nesw-resize"]')).toHaveCount(0);
});

test('depth is still driven by the parameter controls: changing it updates the read-only preview geometry and recalculates price', async ({
  page,
}) => {
  await page.goto('/ru/configurator');

  const depthSelect = page.getByLabel('Глубина');
  await expect(depthSelect).toBeVisible();
  const before = await depthSelect.inputValue();

  const depthTag = page.getByTestId('depth-dimension-tag');
  await expect(depthTag).toHaveText(before);

  await expect.poll(() => getVisiblePriceText(page), { timeout: 10_000 }).not.toBe('');
  const priceBefore = await getVisiblePriceText(page);

  const next = before === '600' ? '800' : '600';
  await depthSelect.selectOption(next);

  // Config, rendered geometry, and price all follow the parameter change —
  // the preview stays a read-only reflection of config.depth, not a second
  // source of truth.
  await expect(depthSelect).toHaveValue(next);
  await expect(depthTag).toHaveText(next);
  await expect.poll(() => getVisiblePriceText(page), { timeout: 10_000 }).not.toBe(priceBefore);
});

test('the selected section is the one width resizing targets, including a newly added one', async ({
  page,
}) => {
  await page.goto('/ru/configurator');

  const addButton = page.getByRole('button', { name: /Добавить секцию после/ }).first();
  await addButton.click();
  await addButton.click();
  await expect(sectionButtons(page)).toHaveCount(3);

  // Select section 2 via the sections panel (pressing its own right upright
  // also targets it — see ShelvingPreview's width-zone handlers; V2.4 no
  // longer selects on mere hover), then drag and confirm only section 2
  // changed. The handle
  // repositions itself to the newly active section on the next render, so
  // wait for that (via aria-pressed on the table button) before reading its
  // on-screen box — otherwise a drag can start against the handle's
  // pre-switch position.
  const section2Button = page.getByRole('button', { name: 'Секция 2', exact: true });
  await section2Button.click();
  await expect(section2Button).toHaveAttribute('aria-pressed', 'true');
  const before = await storedWidths(page);

  const widthHandle = page.locator('button[data-axis="width"]');
  await widthHandle.scrollIntoViewIfNeeded();
  const box = await widthHandle.boundingBox();
  if (!box) throw new Error('Width handle has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await storedWidths(page))[1]).not.toBe(before[1]);
  const after = await storedWidths(page);
  expect([after[0], after[2]]).toEqual([before[0], before[2]]);

  // A newly added (4th) section behaves the same way via its own right upright.
  await addButton.click();
  await expect(sectionButtons(page)).toHaveCount(4);
  const section4Button = page.getByRole('button', { name: 'Секция 4', exact: true });
  await section4Button.click();
  await expect(section4Button).toHaveAttribute('aria-pressed', 'true');
  const before4 = (await storedWidths(page))[3];
  await widthHandle.scrollIntoViewIfNeeded();
  const box2 = await widthHandle.boundingBox();
  if (!box2) throw new Error('Width handle has no bounding box');
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2 - 60, box2.y + box2.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await storedWidths(page))[3]).not.toBe(before4);
});

/**
 * Regression coverage for the width-drag *pixel scale* bug: a section
 * dragged to its catalog min/max used to render at a visibly different
 * on-screen width than that exact same value renders at once actually
 * committed and idle (the row's auto-fit scale was frozen from whatever it
 * was when the drag started, which does not generally match the auto-fit
 * scale a fresh commit at the new width will use). This measures real SVG
 * geometry — the width handle's own x position tracks the active section's
 * right upright 1:1 — not just the numeric label, since the bug could pass
 * a label-only check while still visibly jumping on release.
 */
test('geometry regression: the active section\'s right upright does not jump when a drag releases at the legal minimum', async ({ page }) => {
  await page.goto('/ru/configurator');

  const widthHandle = page.locator('button[data-axis="width"]');
  await expect(widthHandle).toBeVisible();
  await widthHandle.scrollIntoViewIfNeeded();
  const box = await widthHandle.boundingBox();
  if (!box) throw new Error('Width resize handle has no bounding box');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  // Drag far left — well past the legal minimum (700mm) — and hold.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 250, startY, { steps: 20 });
  const liveBox = await widthHandle.boundingBox();
  if (!liveBox) throw new Error('Width handle has no bounding box mid-drag');

  await page.mouse.up();
  await expect(firstSectionWidthSelect(page)).toHaveValue('700');
  const releasedBox = await widthHandle.boundingBox();
  if (!releasedBox) throw new Error('Width handle has no bounding box after release');

  // The upright must sit at (approximately) the same x immediately before
  // and after release — a few px of float/anti-aliasing tolerance, never a
  // whole-section-width jump.
  expect(Math.abs(releasedBox.x - liveBox.x)).toBeLessThan(4);
});

test('geometry regression: the active section\'s right upright does not jump when a drag releases at the legal maximum', async ({ page }) => {
  await page.goto('/ru/configurator');

  const widthHandle = page.locator('button[data-axis="width"]');
  await expect(widthHandle).toBeVisible();
  await widthHandle.scrollIntoViewIfNeeded();
  const box = await widthHandle.boundingBox();
  if (!box) throw new Error('Width resize handle has no bounding box');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  // Drag far right — well past the legal maximum (1500mm) — and hold.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 250, startY, { steps: 20 });
  const liveBox = await widthHandle.boundingBox();
  if (!liveBox) throw new Error('Width handle has no bounding box mid-drag');

  await page.mouse.up();
  await expect(firstSectionWidthSelect(page)).toHaveValue('1500');
  const releasedBox = await widthHandle.boundingBox();
  if (!releasedBox) throw new Error('Width handle has no bounding box after release');

  expect(Math.abs(releasedBox.x - liveBox.x)).toBeLessThan(4);
});

test('the height handle sits on the top rack edge (not to the side), and every handle shows a directional icon', async ({ page }) => {
  await page.goto('/ru/configurator');

  const heightHandle = page.locator('button[data-axis="height"]');
  const rack = page.getByRole('img', { name: 'Схема стеллажа спереди' });
  const heightBox = await heightHandle.boundingBox();
  const rackBox = await rack.boundingBox();
  if (!heightBox || !rackBox) throw new Error('Missing bounding box');

  // "On the top rack edge" — horizontally within the rack's own span, and
  // clearly in the upper portion of the preview (not vertically centred,
  // which is where the old, wrong position put it).
  expect(heightBox.x).toBeGreaterThan(rackBox.x);
  expect(heightBox.x).toBeLessThan(rackBox.x + rackBox.width);
  expect(heightBox.y).toBeLessThan(rackBox.y + rackBox.height * 0.5);

  // Each handle shows its own directional glyph once hovered (the plain,
  // undifferentiated dot from before this task no longer communicates
  // vertical/horizontal/diagonal resize on its own).
  await page.mouse.move(heightBox.x + heightBox.width / 2, heightBox.y + heightBox.height / 2);
  await expect(page.locator('button[data-axis="height"] span')).toHaveText('↕');

  const widthHandle = page.locator('button[data-axis="width"]');
  const wBox = await widthHandle.boundingBox();
  if (!wBox) throw new Error('Width handle has no bounding box');
  await page.mouse.move(wBox.x + wBox.width / 2, wBox.y + wBox.height / 2);
  await expect(page.locator('button[data-axis="width"] span')).toHaveText('↔');
});
