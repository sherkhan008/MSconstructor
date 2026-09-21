import type { Tenge } from '@/lib/money';
import type { DeliveryMethod, DeliveryMethodKind } from '@/lib/types/domain';

/**
 * Free same-day CITY delivery is offered only in the four cities that have a
 * warehouse. Every other city/region is COUNTRY delivery (2–3 days, cost
 * calculated individually).
 *
 * This is the single source of truth for that rule. The order API enforces it
 * against the customer's city, so a request that forges a CITY deliveryId
 * for any other city is rejected rather than priced at the CITY rate.
 */
export type CityDeliveryCity = 'ALMATY' | 'ASTANA' | 'KARAGANDA' | 'SHYMKENT';

/** Customer-facing names, in the order they are listed in public copy. */
export const CITY_DELIVERY_CITY_NAMES: Record<CityDeliveryCity, string> = {
  ALMATY: 'Алматы',
  ASTANA: 'Астана',
  KARAGANDA: 'Караганда',
  SHYMKENT: 'Шымкент',
};

/**
 * Explicit spellings accepted for each city, already in normalized form (see
 * normalizeCityName). Exact matches only — no substring or fuzzy matching,
 * so e.g. "Алматинская область" or "Караганда-Тараз" never qualify.
 */
const CITY_ALIASES: Record<string, CityDeliveryCity> = {
  // Алматы
  алматы: 'ALMATY',
  almaty: 'ALMATY',
  // Астана (named Нур-Султан in 2019–2022)
  астана: 'ASTANA',
  astana: 'ASTANA',
  'нур-султан': 'ASTANA',
  'нұр-сұлтан': 'ASTANA',
  'nur-sultan': 'ASTANA',
  // Караганда (Kazakh: Қарағанды)
  караганда: 'KARAGANDA',
  қарағанды: 'KARAGANDA',
  караганды: 'KARAGANDA',
  karaganda: 'KARAGANDA',
  qaragandy: 'KARAGANDA',
  // Шымкент
  шымкент: 'SHYMKENT',
  shymkent: 'SHYMKENT',
};

/**
 * Lower-cases, folds ё→е, unifies dashes and whitespace, and strips a leading
 * "г." / "город" (ru) or a trailing "қ." / "қаласы" (kk) city marker. Does
 * not guess: anything left over must match an alias exactly.
 */
export function normalizeCityName(raw: string): string {
  const value = raw
    .normalize('NFC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return value
    .replace(/^(?:город\s+|г\.\s*|г\s+)/u, '')
    .replace(/(?:\s+қаласы|\s*қ\.)$/u, '')
    .trim();
}

/** The free-delivery city the input names, or null for any other city. */
export function resolveCityDeliveryCity(raw: string | null | undefined): CityDeliveryCity | null {
  if (!raw) return null;
  return CITY_ALIASES[normalizeCityName(raw)] ?? null;
}

export function isCityDeliveryCity(raw: string | null | undefined): boolean {
  return resolveCityDeliveryCity(raw) !== null;
}

/** True when this delivery kind is restricted to the four cities above. */
export function requiresCityDeliveryCity(kind: DeliveryMethodKind): boolean {
  return kind === 'CITY';
}

/** Customer-safe explanation shown when CITY delivery is chosen for another city. */
export const CITY_DELIVERY_UNAVAILABLE_MESSAGE =
  'Бесплатная доставка по городу доступна только в Алматы, Астане, Караганде и Шымкенте. ' +
  'Для других городов выберите «Доставка по Казахстану» — 2–3 дня. Стоимость доставки рассчитывается индивидуально.';

/**
 * The delivery amount a customer is quoted, or null when it is calculated
 * individually. Only PICKUP and the four-city CITY delivery have a fixed
 * price (both free today). Every other method — COUNTRY, TRANSPORT_COMPANY,
 * INDIVIDUAL — is delivery to another city/region, whose cost is calculated
 * individually: its basePrice is never quoted, so a stored 0 cannot turn
 * regional delivery into "free" or a silent 0 ₸.
 */
export function quotedDeliveryPrice(method: Pick<DeliveryMethod, 'kind' | 'basePrice'>): Tenge | null {
  return method.kind === 'PICKUP' || method.kind === 'CITY' ? method.basePrice : null;
}
