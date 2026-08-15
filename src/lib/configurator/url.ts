import type { ConfigurationAccessorySelection, ShelfType, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

/**
 * Serialises a configuration to URL query parameters and back, so a shared
 * configurator link fully restores the customer's selections — including
 * each section's own width and wall panels, in order:
 *   /configurator?model=ms-standard&height=2000&depth=400&shelves=5
 *     &sections=700:1:0:0,1000:0:0:0,1200:0:1:1
 * Each `sections` entry is `width:rearWall:leftWall:rightWall` (0/1 flags),
 * joined by `,`, in the exact order the sections appear in the row. Every
 * parsed value is validated before use — a shared URL is still untrusted
 * client input, and a malformed one must never crash the configurator.
 */

const SHELF_TYPES: ShelfType[] = ['STANDARD', 'REINFORCED', 'EXTRA_REINFORCED', 'PERFORATED', 'GALVANIZED'];
const MAX_SECTIONS = 10;

function isOneOf<T extends string>(value: string | null, options: readonly T[]): value is T {
  return value !== null && (options as readonly string[]).includes(value);
}

function toInt(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

let idCounter = 0;
function generateSectionId(): string {
  idCounter += 1;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `sec-url-${Date.now()}-${idCounter}`;
}

function encodeSection(section: ShelvingSection): string {
  return [section.width, section.rearWall ? 1 : 0, section.leftWall ? 1 : 0, section.rightWall ? 1 : 0].join(':');
}

/** Parses one `width:rearWall:leftWall:rightWall` token. Returns undefined for a malformed entry. */
function decodeSection(token: string): ShelvingSection | undefined {
  const parts = token.split(':');
  const width = Number.parseInt(parts[0] ?? '', 10);
  if (!Number.isFinite(width) || width <= 0) return undefined;
  return {
    id: generateSectionId(),
    width,
    rearWall: parts[1] === '1',
    leftWall: parts[2] === '1',
    rightWall: parts[3] === '1',
  };
}

export function configurationToSearchParams(config: ShelvingConfiguration): URLSearchParams {
  const params = new URLSearchParams();
  params.set('model', config.modelSlug);
  params.set('height', String(config.height));
  params.set('depth', String(config.depth));
  params.set('shelves', String(config.shelves));
  params.set('sections', config.sections.map(encodeSection).join(','));
  params.set('load', String(config.loadCapacity));
  params.set('shelfType', config.shelfType);
  params.set('color', config.colorId);
  params.set('assembly', config.assemblyId);
  params.set('delivery', config.deliveryId);
  params.set('qty', String(config.quantity));
  if (config.accessories.length > 0) {
    params.set('acc', config.accessories.map((a) => `${a.accessoryId}:${a.quantity}`).join(','));
  }
  if (config.promoCode) params.set('promo', config.promoCode);
  return params;
}

export function configurationToShareQuery(config: ShelvingConfiguration): string {
  return configurationToSearchParams(config).toString();
}

/**
 * Parses URL search params into a partial configuration. Unknown/invalid
 * keys are ignored rather than throwing, so a malformed or hand-edited URL
 * degrades to "use the default for that field" instead of crashing the page.
 * Also supports the legacy `width` + `sections=<count>` shape (before
 * per-section widths existed) by expanding it into N equal-width sections.
 */
export function parseConfigurationFromSearchParams(
  params: URLSearchParams,
): Partial<ShelvingConfiguration> {
  const result: Partial<ShelvingConfiguration> = {};

  const model = params.get('model');
  if (model && /^[a-z0-9-]+$/.test(model)) result.modelSlug = model;

  const height = toInt(params.get('height'));
  if (height !== undefined) result.height = height;
  const depth = toInt(params.get('depth'));
  if (depth !== undefined) result.depth = depth;
  const shelves = toInt(params.get('shelves'));
  if (shelves !== undefined) result.shelves = shelves;
  const load = toInt(params.get('load'));
  if (load !== undefined) result.loadCapacity = load;
  const qty = toInt(params.get('qty'));
  if (qty !== undefined) result.quantity = qty;

  const shelfType = params.get('shelfType');
  if (isOneOf(shelfType, SHELF_TYPES)) result.shelfType = shelfType;

  const color = params.get('color');
  if (color) result.colorId = color;

  const assembly = params.get('assembly');
  if (assembly) result.assemblyId = assembly;

  const delivery = params.get('delivery');
  if (delivery) result.deliveryId = delivery;

  const promo = params.get('promo');
  if (promo) result.promoCode = promo;

  const acc = params.get('acc');
  if (acc) {
    const accessories: ConfigurationAccessorySelection[] = [];
    for (const entry of acc.split(',')) {
      const [accessoryId, qtyRaw] = entry.split(':');
      const quantity = Number.parseInt(qtyRaw ?? '1', 10);
      if (accessoryId && Number.isFinite(quantity) && quantity > 0) {
        accessories.push({ accessoryId, quantity });
      }
    }
    result.accessories = accessories;
  }

  const sectionsParam = params.get('sections');
  const legacyWidth = toInt(params.get('width'));
  if (sectionsParam) {
    const tokens = sectionsParam.split(',').filter(Boolean);
    const looksLegacy = tokens.length > 0 && !tokens[0].includes(':');
    if (looksLegacy) {
      // Legacy shape: `sections` was a plain count sharing the top-level `width`.
      const count = Math.min(Math.max(Number.parseInt(tokens[0], 10) || 1, 1), MAX_SECTIONS);
      const width = legacyWidth && legacyWidth > 0 ? legacyWidth : 1000;
      result.sections = Array.from({ length: count }, () => ({
        id: generateSectionId(),
        width,
        rearWall: false,
        leftWall: false,
        rightWall: false,
      }));
    } else {
      const decoded = tokens.map(decodeSection).filter((s): s is ShelvingSection => s !== undefined);
      if (decoded.length > 0) result.sections = decoded.slice(0, MAX_SECTIONS);
    }
  } else if (legacyWidth && legacyWidth > 0) {
    // Pre-section-array legacy URL with only `width` and no `sections` at all.
    result.sections = [{ id: generateSectionId(), width: legacyWidth, rearWall: false, leftWall: false, rightWall: false }];
  }

  return result;
}
