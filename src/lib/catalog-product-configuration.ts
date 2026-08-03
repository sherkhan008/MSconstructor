import type { CatalogProduct, ShelvingConfiguration } from '@/lib/types/domain';

/**
 * Builds a full, priceable configuration from a catalog listing entry.
 * CatalogProduct only stores the dimensions/shelves/load a card displays —
 * this fills in the remaining defaults (assembly, delivery, walls, quantity)
 * so the result can be run through the same calculatePrice() every other
 * entry point uses.
 */
export function catalogProductToConfiguration(
  product: CatalogProduct,
  overrides: Partial<ShelvingConfiguration> = {},
): ShelvingConfiguration {
  return {
    modelSlug: product.modelSlug,
    configurationType: product.sections > 1 ? 'STARTER_WITH_EXTENSIONS' : 'SINGLE',
    height: product.height,
    width: product.width,
    depth: product.depth,
    shelves: product.shelves,
    sections: product.sections,
    loadCapacity: product.loadCapacity,
    shelfType: product.shelfType,
    colorId: product.color,
    rear: 'CROSS_BRACE',
    side: 'NONE',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    ...overrides,
  };
}
