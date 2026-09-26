import type { Page } from '@playwright/test';

/**
 * Configurator V2.4 lists every section as a row, but only the ACTIVE
 * section is expanded with its own controls (width/height selects, shelf
 * stepper, walls); the others collapse to a summary button. These helpers
 * are the stable ways specs read that panel.
 */

/** One button per section ("Секция N") — the collapsed rows and the active
 * row's header alike. The preview's own section hit areas are named
 * "Секция N, ширина W мм", so the anchored pattern never matches them. */
export function sectionButtons(page: Page) {
  return page.getByRole('button', { name: /^Секция \d+$/ });
}

export function sectionButton(page: Page, n: number) {
  return page.getByRole('button', { name: `Секция ${n}`, exact: true });
}

/** Makes section `n` active (its controls expanded) and waits until it is. */
export async function selectSection(page: Page, n: number) {
  const button = sectionButton(page, n);
  await button.click();
  await page.locator(`select[aria-label="Ширина секции ${n}"]`).waitFor();
}

export interface StoredSection {
  id: string;
  width: number;
  height: number;
  shelves: number;
  rearWall: boolean;
  leftWall: boolean;
  rightWall: boolean;
}

/** Every section of the ACTIVE kit as the configurator store persisted it
 * (localStorage, V2.5 workspace) — the real configuration state, including
 * sections whose controls are collapsed. */
export async function storedSections(page: Page): Promise<StoredSection[]> {
  return (await storedActiveConfiguration(page))?.sections ?? [];
}

export interface StoredKit {
  id: string;
  configuration: { sections: StoredSection[]; quantity: number; depth: number; shelfType: string } & Record<string, unknown>;
  activeSectionId: string;
}

/** The persisted V2.5 workspace: every kit in order and the active kit id. */
export async function storedWorkspace(page: Page): Promise<{ kits: StoredKit[]; activeKitId: string } | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('ms-shelving-configurator');
    return raw ? (JSON.parse(raw).state as { kits: StoredKit[]; activeKitId: string }) : null;
  });
}

/** The active kit's persisted configuration. */
export async function storedActiveConfiguration(page: Page): Promise<StoredKit['configuration'] | null> {
  const workspace = await storedWorkspace(page);
  if (!workspace) return null;
  return (workspace.kits.find((k) => k.id === workspace.activeKitId) ?? workspace.kits[0])?.configuration ?? null;
}

export async function storedWidths(page: Page): Promise<number[]> {
  return (await storedSections(page)).map((s) => s.width);
}
