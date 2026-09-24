/**
 * Physical-kit limit for one order. A cart line is one configuration; its
 * `quantity` is how many physical racks (kits) of it are ordered, so the
 * limit counts quantities, not lines: 1 line × 5, 5 lines × 1 and
 * 3 × 1 + 1 × 2 are all allowed, any total of 6 or more is not.
 *
 * Server-safe and dependency-free: the order request schema
 * (src/lib/pricing/schema.ts) is the authority; the cart store and the
 * cart/checkout/configurator UI only mirror the same rule.
 */
export const MAX_KITS_PER_ORDER = 5;

interface KitLine {
  configuration: { quantity: number };
}

/** Total physical kits across all lines: sum of configuration.quantity. */
export function getPhysicalKitCount(items: readonly KitLine[]): number {
  return items.reduce((sum, item) => sum + item.configuration.quantity, 0);
}

/** How many more kits fit into this order (0 when full or already over the limit). */
export function getRemainingKitCapacity(items: readonly KitLine[]): number {
  return Math.max(0, MAX_KITS_PER_ORDER - getPhysicalKitCount(items));
}

/** Whether `additional` more kits can join these lines without passing the limit. */
export function canAddKits(items: readonly KitLine[], additional: number): boolean {
  return getPhysicalKitCount(items) + additional <= MAX_KITS_PER_ORDER;
}

/** Whether these lines are over the limit (e.g. a cart persisted before it existed). */
export function exceedsKitLimit(items: readonly KitLine[]): boolean {
  return getPhysicalKitCount(items) > MAX_KITS_PER_ORDER;
}
