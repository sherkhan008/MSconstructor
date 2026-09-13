import type { ComponentType } from '@/lib/types/domain';
import type { PriceEntityType, PriceField } from '@/lib/admin/prices';

/**
 * Admin-facing Russian labels for the price-management screen.
 *
 * Kept beside the other admin label maps (cf. src/lib/orders/status-labels.ts)
 * rather than inlined in a component, so the table, the edit dialog and the
 * history panel all name the same thing the same way.
 */

export const PRICE_ENTITY_LABEL_RU: Record<PriceEntityType, string> = {
  COMPONENT: 'Комплектующее',
  ACCESSORY: 'Аксессуар',
};

/**
 * Business names for the two editable prices. `Component.sellingPrice` and
 * `Accessory.unitPrice` are the same thing commercially, so both appear under
 * "Цена продажи" — database column naming is never shown to an admin.
 */
export const PRICE_FIELD_LABEL_RU: Record<PriceField, string> = {
  SELLING_PRICE: 'Цена продажи',
  PURCHASE_PRICE: 'Закупочная цена',
};

/**
 * Shown for a PriceHistory row whose `field` is NULL — possible only for rows
 * written before that column existed. The label states what is known (a price
 * changed) and never guesses which of the two it was.
 */
export const PRICE_FIELD_UNKNOWN_LABEL_RU = 'Изменение цены';

/** Ordered for the filter select; wording follows the seed catalog names. */
export const COMPONENT_TYPE_LABEL_RU: Record<ComponentType, string> = {
  UPRIGHT: 'Стойка',
  SHELF: 'Полка',
  BEAM_LONGITUDINAL: 'Балка продольная',
  BEAM_DEPTH: 'Балка поперечная',
  TIE: 'Стяжка рамы',
  CROSS_BRACE: 'Раскос',
  FASTENER: 'Крепёж',
  FOOT: 'Опора',
  CONNECTOR: 'Соединение секций',
  REAR_WALL: 'Задняя стенка',
  SIDE_WALL: 'Боковая стенка',
};

export const COMPONENT_TYPE_VALUES = Object.keys(COMPONENT_TYPE_LABEL_RU) as ComponentType[];

/** Falls back to the raw enum value so an unmapped future type is still readable. */
export function componentTypeLabel(type: string | null): string | null {
  if (!type) return null;
  return COMPONENT_TYPE_LABEL_RU[type as ComponentType] ?? type;
}
