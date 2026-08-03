import type { Catalog } from './repository';
import { stripAccessorySecrets } from './repository';
import type {
  AssemblyService,
  ColorOption,
  DeliveryMethod,
  DimensionOption,
  LoadCapacityOption,
  ProductModel,
  PublicAccessory,
} from '@/lib/types/domain';

/**
 * The slice of the catalog that is safe to ship to the browser: no
 * components/rules (internal BOM machinery), no purchase prices, and no
 * promo code list (nothing to guess against). The configurator client reads
 * only this shape.
 */
export interface PublicCatalog {
  models: ProductModel[];
  heights: DimensionOption[];
  widths: DimensionOption[];
  depths: DimensionOption[];
  loadCapacities: LoadCapacityOption[];
  colors: ColorOption[];
  accessories: PublicAccessory[];
  assemblyServices: AssemblyService[];
  deliveryMethods: DeliveryMethod[];
  useCases: { id: string; ru: string; kk: string }[];
}

export function toPublicCatalog(catalog: Catalog): PublicCatalog {
  return {
    models: catalog.models.filter((m) => m.active),
    heights: catalog.heights.filter((h) => h.active),
    widths: catalog.widths.filter((w) => w.active),
    depths: catalog.depths.filter((d) => d.active),
    loadCapacities: catalog.loadCapacities.filter((l) => l.active),
    colors: catalog.colors.filter((c) => c.available),
    accessories: catalog.accessories.filter((a) => a.active).map(stripAccessorySecrets),
    assemblyServices: catalog.assemblyServices.filter((a) => a.active),
    deliveryMethods: catalog.deliveryMethods.filter((d) => d.active),
    useCases: catalog.useCases,
  };
}
