import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import { LEGACY_MAX_SECTIONS } from '@/lib/configurator/limits';

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
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function readSection(raw: unknown): ShelvingSection | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, width, height, shelves, rearWall, leftWall, rightWall } = raw;
  if (!isNonEmptyString(id) || !isPositiveInt(width) || !isPositiveInt(height) || !isPositiveInt(shelves)) return undefined;
  if (typeof rearWall !== 'boolean' || typeof leftWall !== 'boolean' || typeof rightWall !== 'boolean') return undefined;
  return { id, width, height, shelves, rearWall, leftWall, rightWall };
}

function readSections(raw: unknown): ShelvingSection[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LEGACY_MAX_SECTIONS) return undefined;
  const sections: ShelvingSection[] = [];
  for (const item of raw) {
    const section = readSection(item);
    if (!section) return undefined;
    sections.push(section);
  }
  return new Set(sections.map((s) => s.id)).size === sections.length ? sections : undefined;
}

/**
 * Reads a configuration in the current (V2.2A, per-section height/shelves)
 * shape. A configuration that still carries a row-level `height` or
 * `shelves` is NOT current — it is rejected rather than silently mixed.
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
 * Upgrades a configuration persisted before V2.2A, when height and shelf
 * count were row-level fields shared by every section. The upgrade is
 * lossless and deterministic: that one height/shelf count is exactly what
 * every section had, so it is copied into each section and the row-level
 * fields are dropped. Anything malformed returns `undefined`.
 */
export function upgradeRowLevelConfiguration(raw: unknown): ShelvingConfiguration | undefined {
  if (!isRecord(raw)) return undefined;
  const { height, shelves, sections, ...rest } = raw;
  if (!isPositiveInt(height) || !isPositiveInt(shelves) || !Array.isArray(sections)) return undefined;
  const upgradedSections = sections.map((section) => (isRecord(section) ? { ...section, height, shelves } : section));
  return readPersistedConfiguration({ ...rest, sections: upgradedSections });
}
