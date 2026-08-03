import type {
  ConfigurationAccessorySelection,
  ConfigurationType,
  RearOption,
  ShelfType,
  ShelvingConfiguration,
  SideOption,
} from '@/lib/types/domain';

/**
 * Serialises a configuration to URL query parameters and back, so a
 * configurator link like
 *   /configurator?model=ms-standard&height=2000&width=1000&depth=400&shelves=5&sections=1
 * fully restores the customer's selections. Every parsed value is validated
 * before use — a shared URL is still untrusted client input.
 */

const CONFIGURATION_TYPES: ConfigurationType[] = [
  'SINGLE',
  'MULTIPLE_INDEPENDENT',
  'STARTER_WITH_EXTENSIONS',
  'CONTINUOUS_ROW',
  'L_SHAPE',
  'U_SHAPE',
];
const SHELF_TYPES: ShelfType[] = ['STANDARD', 'REINFORCED', 'EXTRA_REINFORCED', 'PERFORATED', 'GALVANIZED'];
const REAR_OPTIONS: RearOption[] = ['NONE', 'CROSS_BRACE', 'SOLID', 'PERFORATED'];
const SIDE_OPTIONS: SideOption[] = [
  'NONE',
  'LEFT',
  'RIGHT',
  'BOTH',
  'LEFT_PERFORATED',
  'RIGHT_PERFORATED',
  'BOTH_PERFORATED',
];

function isOneOf<T extends string>(value: string | null, options: readonly T[]): value is T {
  return value !== null && (options as readonly string[]).includes(value);
}

function toInt(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function configurationToSearchParams(config: ShelvingConfiguration): URLSearchParams {
  const params = new URLSearchParams();
  params.set('model', config.modelSlug);
  params.set('type', config.configurationType);
  params.set('height', String(config.height));
  params.set('width', String(config.width));
  params.set('depth', String(config.depth));
  params.set('shelves', String(config.shelves));
  params.set('sections', String(config.sections));
  params.set('load', String(config.loadCapacity));
  params.set('shelfType', config.shelfType);
  params.set('color', config.colorId);
  params.set('rear', config.rear);
  params.set('side', config.side);
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

/** Parses URL search params into a partial configuration. Unknown/invalid keys are ignored. */
export function parseConfigurationFromSearchParams(
  params: URLSearchParams,
): Partial<ShelvingConfiguration> {
  const result: Partial<ShelvingConfiguration> = {};

  const model = params.get('model');
  if (model && /^[a-z0-9-]+$/.test(model)) result.modelSlug = model;

  const type = params.get('type');
  if (isOneOf(type, CONFIGURATION_TYPES)) result.configurationType = type;

  const height = toInt(params.get('height'));
  if (height !== undefined) result.height = height;
  const width = toInt(params.get('width'));
  if (width !== undefined) result.width = width;
  const depth = toInt(params.get('depth'));
  if (depth !== undefined) result.depth = depth;
  const shelves = toInt(params.get('shelves'));
  if (shelves !== undefined) result.shelves = shelves;
  const sections = toInt(params.get('sections'));
  if (sections !== undefined) result.sections = sections;
  const load = toInt(params.get('load'));
  if (load !== undefined) result.loadCapacity = load;
  const qty = toInt(params.get('qty'));
  if (qty !== undefined) result.quantity = qty;

  const shelfType = params.get('shelfType');
  if (isOneOf(shelfType, SHELF_TYPES)) result.shelfType = shelfType;

  const rear = params.get('rear');
  if (isOneOf(rear, REAR_OPTIONS)) result.rear = rear;

  const side = params.get('side');
  if (isOneOf(side, SIDE_OPTIONS)) result.side = side;

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

  return result;
}
