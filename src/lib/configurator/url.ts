import type { ConfigurationAccessorySelection, ShelfType, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import { LEGACY_MAX_SECTIONS } from '@/lib/configurator/limits';

/**
 * Serialises a configuration to URL query parameters and back, so a shared
 * configurator link fully restores the customer's selections — including
 * each section's own width, height, shelf count and wall panels, in order.
 *
 * Format v2 (Configurator V2.2A), marked by `v=2`:
 *   /configurator?v=2&model=ms-standard&depth=400
 *     &sections=700:1500:4:1:0:0,1000:1500:4:0:0:0,1200:1500:4:0:1:1
 * Each `sections` entry is exactly
 *   `width:height:shelves:rearWall:leftWall:rightWall`
 * — three positive integers (mm, mm, count) then three 0/1 flags — joined
 * by `,`, in the exact order the sections appear in the row. There is no
 * row-level height/shelves parameter in v2.
 *
 * Parsing is strict and all-or-nothing for sections: one malformed entry
 * discards the whole `sections` list (dropping a single entry would shift
 * the row positions section-scoped accessories refer to). Every other
 * parsed value is validated before use too — a shared URL is untrusted
 * client input, and a malformed one must never crash the configurator.
 *
 * Legacy (no `v`): the V2.1 format with row-level `height` + `shelves` and
 * `width:rearWall:leftWall:rightWall` entries is still read, by copying
 * that one height/shelf count into every section (lossless — that is what
 * every section had). Anything else unversioned, or an unknown `v`, leaves
 * the sections untouched. The app itself only ever generates v2.
 *
 * Section count: parsed up to LEGACY_MAX_SECTIONS, not MAX_SECTIONS, so a
 * link shared before the limit dropped opens with all its sections (shown as
 * over the limit, and rejected by the server until reduced) instead of
 * silently losing some. See src/lib/configurator/limits.ts.
 */

export const CONFIGURATION_URL_VERSION = '2';

const SHELF_TYPES: ShelfType[] = ['STANDARD', 'REINFORCED', 'EXTRA_REINFORCED', 'PERFORATED', 'GALVANIZED'];

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
  return [
    section.width,
    section.height,
    section.shelves,
    section.rearWall ? 1 : 0,
    section.leftWall ? 1 : 0,
    section.rightWall ? 1 : 0,
  ].join(':');
}

const POSITIVE_INT = /^[1-9]\d{0,5}$/;
const FLAG = /^[01]$/;

/** Parses one v2 `width:height:shelves:rear:left:right` entry; undefined unless exactly well-formed. */
function decodeSection(token: string): ShelvingSection | undefined {
  const parts = token.split(':');
  if (parts.length !== 6) return undefined;
  const [width, height, shelves, rear, left, right] = parts;
  if (![width, height, shelves].every((p) => POSITIVE_INT.test(p)) || ![rear, left, right].every((p) => FLAG.test(p))) {
    return undefined;
  }
  return {
    id: generateSectionId(),
    width: Number(width),
    height: Number(height),
    shelves: Number(shelves),
    rearWall: rear === '1',
    leftWall: left === '1',
    rightWall: right === '1',
  };
}

/** Parses one legacy V2.1 `width:rear:left:right` entry (flags strictly 0/1)
 * with the link's row-level height/shelves; undefined unless exactly well-formed. */
function decodeLegacySection(token: string, height: number, shelves: number): ShelvingSection | undefined {
  const parts = token.split(':');
  if (parts.length !== 4) return undefined;
  const [width, rear, left, right] = parts;
  if (!POSITIVE_INT.test(width) || ![rear, left, right].every((p) => FLAG.test(p))) return undefined;
  return {
    id: generateSectionId(),
    width: Number(width),
    height,
    shelves,
    rearWall: rear === '1',
    leftWall: left === '1',
    rightWall: right === '1',
  };
}

/** All-or-nothing: any malformed entry discards the whole list. */
function decodeAll(tokens: string[], decode: (token: string) => ShelvingSection | undefined): ShelvingSection[] | undefined {
  if (tokens.length === 0 || tokens.length > LEGACY_MAX_SECTIONS) return undefined;
  const sections: ShelvingSection[] = [];
  for (const token of tokens) {
    const section = decode(token);
    if (!section) return undefined;
    sections.push(section);
  }
  return sections;
}

function parseSections(params: URLSearchParams): ShelvingSection[] | undefined {
  const sectionsParam = params.get('sections');
  if (!sectionsParam) return undefined;
  const tokens = sectionsParam.split(',');
  const version = params.get('v');
  if (version === CONFIGURATION_URL_VERSION) return decodeAll(tokens, decodeSection);
  if (version !== null) return undefined;

  // The row-level values are copied into every section, so they get the
  // same strictness as a v2 entry ("2000abc" or "2000.5" is not 2000).
  const heightRaw = params.get('height') ?? '';
  const shelvesRaw = params.get('shelves') ?? '';
  if (!POSITIVE_INT.test(heightRaw) || !POSITIVE_INT.test(shelvesRaw)) return undefined;
  const height = Number(heightRaw);
  const shelves = Number(shelvesRaw);
  return decodeAll(tokens, (token) => decodeLegacySection(token, height, shelves));
}

export function configurationToSearchParams(config: ShelvingConfiguration): URLSearchParams {
  const params = new URLSearchParams();
  params.set('v', CONFIGURATION_URL_VERSION);
  params.set('model', config.modelSlug);
  params.set('depth', String(config.depth));
  params.set('sections', config.sections.map(encodeSection).join(','));
  params.set('load', String(config.loadCapacity));
  params.set('shelfType', config.shelfType);
  params.set('color', config.colorId);
  params.set('assembly', config.assemblyId);
  params.set('delivery', config.deliveryId);
  params.set('qty', String(config.quantity));
  if (config.accessories.length > 0) {
    // A section-scoped accessory is encoded with the target section's
    // *position* in the row, not its internal id — decodeSection always
    // mints a fresh id on parse (see below), so the original id would never
    // match anything after a round trip. The position survives intact.
    params.set(
      'acc',
      config.accessories
        .map((a) => {
          if (!a.sectionId) return `${a.accessoryId}:${a.quantity}`;
          const index = config.sections.findIndex((s) => s.id === a.sectionId);
          return index === -1 ? `${a.accessoryId}:${a.quantity}` : `${a.accessoryId}:${a.quantity}:${index}`;
        })
        .join(','),
    );
  }
  if (config.promoCode) params.set('promo', config.promoCode);
  if (config.metalFootPad) params.set('metalFootPad', '1');
  if (config.shelfCornerBrackets) params.set('shelfCornerBrackets', '1');
  return params;
}

export function configurationToShareQuery(config: ShelvingConfiguration): string {
  return configurationToSearchParams(config).toString();
}

/**
 * Parses URL search params into a partial configuration. Unknown/invalid
 * keys are ignored rather than throwing, so a malformed or hand-edited URL
 * degrades to "use the default for that field" instead of crashing the page.
 * See the module comment for the (strict, versioned) `sections` format.
 */
export function parseConfigurationFromSearchParams(
  params: URLSearchParams,
): Partial<ShelvingConfiguration> {
  const result: Partial<ShelvingConfiguration> = {};

  const model = params.get('model');
  if (model && /^[a-z0-9-]+$/.test(model)) result.modelSlug = model;

  const depth = toInt(params.get('depth'));
  if (depth !== undefined) result.depth = depth;
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

  const metalFootPad = params.get('metalFootPad');
  if (metalFootPad === '1') result.metalFootPad = true;
  const shelfCornerBrackets = params.get('shelfCornerBrackets');
  if (shelfCornerBrackets === '1') result.shelfCornerBrackets = true;

  const sections = parseSections(params);
  if (sections) result.sections = sections;

  // Parsed after `sections` — a section-scoped accessory's third segment is
  // a row position, resolved against the *freshly generated* section ids
  // above (decodeSection never reuses the original sender's ids).
  const acc = params.get('acc');
  // v2 links always describe the whole kit: no `acc` means no accessories,
  // so opening one never keeps accessories left over in the current draft.
  if (!acc && params.get('v') === CONFIGURATION_URL_VERSION) result.accessories = [];
  if (acc) {
    const accessories: ConfigurationAccessorySelection[] = [];
    for (const entry of acc.split(',')) {
      const [accessoryId, qtyRaw, indexRaw] = entry.split(':');
      const quantity = Number.parseInt(qtyRaw ?? '1', 10);
      if (!accessoryId || !Number.isFinite(quantity) || quantity <= 0) continue;
      if (indexRaw === undefined) {
        accessories.push({ accessoryId, quantity });
        continue;
      }
      const index = Number.parseInt(indexRaw, 10);
      const sectionId = result.sections?.[index]?.id;
      accessories.push(sectionId ? { accessoryId, quantity, sectionId } : { accessoryId, quantity });
    }
    result.accessories = accessories;
  }

  return result;
}
