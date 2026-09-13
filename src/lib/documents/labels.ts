import { findAssembly, findColor, findDelivery, findModel, type Catalog } from '@/lib/data/repository';
import type { DocumentLabels } from './build';

/**
 * Russian display names for the ids a saved configuration stores. Names
 * only: this object has no way to hand a price, markup or rate to the
 * document builder, which is what keeps catalog changes from ever moving a
 * historical document's amounts.
 */
export function documentLabelsFromCatalog(catalog: Catalog): DocumentLabels {
  return {
    modelName: (slug) => findModel(catalog, slug)?.name.ru,
    colorName: (id) => findColor(catalog, id)?.name.ru,
    assemblyName: (id) => findAssembly(catalog, id)?.name.ru,
    deliveryName: (id) => findDelivery(catalog, id)?.name.ru,
  };
}
