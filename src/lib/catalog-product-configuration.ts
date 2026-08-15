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
 * entry point uses. `product.sections` is a plain count (identical-width
 * sections) here — the live configurator's independent per-section widths
 * only start diverging once the customer opens "Настроить".
 */
export function catalogProductToConfiguration(
  product: CatalogProduct,
  overrides: Partial<ShelvingConfiguration> = {},
): ShelvingConfiguration {
  return {
    modelSlug: product.modelSlug,
    height: product.height,
    depth: product.depth,
    shelves: product.shelves,
    sections: Array.from({ length: Math.max(1, product.sections) }, () => ({
      id: generateSectionId(),
      width: product.width,
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
