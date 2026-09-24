import type { CatalogProduct, ShelvingConfiguration } from '@/lib/types/domain';

let idCounter = 0;
function generateSectionId(): string {
  idCounter += 1;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `sec-catalog-${idCounter}`;
}

/**
 * Builds a full, priceable configuration from a catalog listing entry.
 * CatalogProduct only stores the dimensions/shelves/load a card displays —
 * this fills in the remaining defaults (assembly, delivery, walls, quantity)
 * so the result can be run through the same calculatePrice() every other
 * entry point uses. `product.sections` is a plain count here: today's
 * catalog products are uniform, so the product's width, height and shelf
 * count are copied into every generated section (each section owns its own
 * values — there is no row-level height/shelves). Per-section values only
 * start diverging once the customer opens "Настроить".
 */
export function catalogProductToConfiguration(
  product: CatalogProduct,
  overrides: Partial<ShelvingConfiguration> = {},
): ShelvingConfiguration {
  return {
    modelSlug: product.modelSlug,
    depth: product.depth,
    sections: Array.from({ length: Math.max(1, product.sections) }, () => ({
      id: generateSectionId(),
      width: product.width,
      height: product.height,
      shelves: product.shelves,
      rearWall: false,
      leftWall: false,
      rightWall: false,
    })),
    loadCapacity: product.loadCapacity,
    shelfType: product.shelfType,
    colorId: product.color,
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    ...overrides,
  };
}
