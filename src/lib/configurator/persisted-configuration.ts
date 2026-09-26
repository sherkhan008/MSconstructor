import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import { LEGACY_MAX_SECTIONS } from '@/lib/configurator/limits';
import { areSectionCornersValid, isSectionCorner } from '@/lib/configurator/corners';

/**
 * Structural readers for configurations persisted in the browser (the
 * configurator draft and the cart). Browser storage is untrusted: these only
 * accept a value whose shape is exactly the current domain shape and return
 * `undefined` for anything else — they never guess, clamp or fill in a
 * malformed value. Business validity (supported heights, shelf limits,
 * width×depth, prices) is not checked here; the configurator normalizes
 * against the MS Standard matrix and the server re-validates everything.
 *
 * Section count is accepted up to LEGACY_MAX_SECTIONS (not MAX_SECTIONS), so
 * a draft saved before the 5-section limit is kept intact and shown as over
 * the limit instead of being silently cut down — see limits.ts.
 *
 * Corners (V2.6): every current section carries its own `corner`, one of the
 * three orientations, placed where the rules allow (corners.ts). A missing,
 * unknown or misplaced corner makes the whole configuration unreadable —
 * never guessed, moved or dropped. Only the explicit upgrades below (for data
 * saved before corners existed) add `corner: 'NONE'`, which is exactly what
 * every section of such data was.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function readSection(raw: unknown): ShelvingSection | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, width, height, shelves, rearWall, leftWall, rightWall, corner } = raw;
  if (!isNonEmptyString(id) || !isPositiveInt(width) || !isPositiveInt(height) || !isPositiveInt(shelves)) return undefined;
  if (typeof rearWall !== 'boolean' || typeof leftWall !== 'boolean' || typeof rightWall !== 'boolean') return undefined;
  if (!isSectionCorner(corner)) return undefined;
  return { id, width, height, shelves, rearWall, leftWall, rightWall, corner };
}

function readSections(raw: unknown): ShelvingSection[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LEGACY_MAX_SECTIONS) return undefined;
  const sections: ShelvingSection[] = [];
  for (const item of raw) {
    const section = readSection(item);
    if (!section) return undefined;
    sections.push(section);
  }
  if (new Set(sections.map((s) => s.id)).size !== sections.length) return undefined;
  return areSectionCornersValid(sections) ? sections : undefined;
}

/**
 * Reads a configuration in the current (V2.6: per-section height/shelves and
 * orientation) shape. A configuration that still carries a row-level `height`
 * or `shelves`, or a section without `corner`, is NOT current — it is
 * rejected rather than silently mixed.
 */
export function readPersistedConfiguration(raw: unknown): ShelvingConfiguration | undefined {
  if (!isRecord(raw)) return undefined;
  if ('height' in raw || 'shelves' in raw) return undefined;
  const sections = readSections(raw.sections);
  if (!sections) return undefined;
  const { modelSlug, depth, loadCapacity, shelfType, colorId, accessories, assemblyId, deliveryId, quantity } = raw;
  if (!isNonEmptyString(modelSlug) || !isPositiveInt(depth) || !isPositiveInt(loadCapacity) || !isPositiveInt(quantity)) {
    return undefined;
  }
  if (!isNonEmptyString(shelfType) || !isNonEmptyString(colorId) || !isNonEmptyString(assemblyId) || !isNonEmptyString(deliveryId)) {
    return undefined;
  }
  const isAccessory = (a: unknown) =>
    isRecord(a) &&
    isNonEmptyString(a.accessoryId) &&
    isPositiveInt(a.quantity) &&
    (a.sectionId === undefined || isNonEmptyString(a.sectionId));
  if (!Array.isArray(accessories) || !accessories.every(isAccessory)) return undefined;
  const optionalOfType = (key: string, type: 'string' | 'boolean') => raw[key] === undefined || typeof raw[key] === type;
  if (!optionalOfType('promoCode', 'string') || !optionalOfType('priceLevel', 'string') || !optionalOfType('name', 'string')) {
    return undefined;
  }
  if (!optionalOfType('metalFootPad', 'boolean') || !optionalOfType('shelfCornerBrackets', 'boolean')) return undefined;
  return { ...(raw as unknown as ShelvingConfiguration), sections };
}

/**
 * Upgrades a configuration persisted before V2.6 (V2.2A–V2.5 shape), when
 * every section was straight and had no `corner` field. Lossless: each
 * section gets `corner: 'NONE'` — exactly what it was. A section that already
 * carries a `corner` is not that shape, and anything malformed returns
 * `undefined`.
 */
export function upgradeStraightConfiguration(raw: unknown): ShelvingConfiguration | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.sections)) return undefined;
  if (raw.sections.some((section) => !isRecord(section) || 'corner' in section)) return undefined;
  const sections = raw.sections.map((section) => ({ ...(section as Record<string, unknown>), corner: 'NONE' }));
  return readPersistedConfiguration({ ...raw, sections });
}

/**
 * Upgrades a configuration persisted before V2.2A, when height and shelf
 * count were row-level fields shared by every section (and every section was
 * straight). The upgrade is lossless and deterministic: that one height/shelf
 * count is exactly what every section had, so it is copied into each section
 * and the row-level fields are dropped; then as upgradeStraightConfiguration.
 * Anything malformed returns `undefined`.
 */
export function upgradeRowLevelConfiguration(raw: unknown): ShelvingConfiguration | undefined {
  if (!isRecord(raw)) return undefined;
  const { height, shelves, sections, ...rest } = raw;
  if (!isPositiveInt(height) || !isPositiveInt(shelves) || !Array.isArray(sections)) return undefined;
  const upgradedSections = sections.map((section) => (isRecord(section) ? { ...section, height, shelves } : section));
  return upgradeStraightConfiguration({ ...rest, sections: upgradedSections });
}
