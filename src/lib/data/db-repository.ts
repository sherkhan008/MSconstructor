import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import type {
  Accessory,
  AssemblyMethod,
  AssemblyService,
  CatalogProduct,
  ColorOption,
  ComponentType,
  ConfigurationRule,
  DeliveryMethod,
  DeliveryMethodKind,
  DimensionOption,
  LoadCapacityOption,
  PriceLevel,
  PricingSettings,
  ProductModel,
  PromoCode,
  ShelfType,
  ShelvingComponent,
} from '@/lib/types/domain';
import { USE_CASES } from './seed-data';
import type { Catalog } from './repository';

/**
 * Database-backed catalog repository. Loaded dynamically by
 * src/lib/data/repository.ts only when DATABASE_URL points at PostgreSQL.
 * Every function returns the exact same shapes as the in-memory mock catalog
 * so the pricing engine and UI never need to know which source is active.
 */

const toNumber = (value: Prisma.Decimal | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

function toModel(row: Awaited<ReturnType<typeof prisma.productModel.findMany>>[number]): ProductModel {
  return {
    id: row.id,
    slug: row.slug,
    name: { ru: row.nameRu, kk: row.nameKk },
    shortDescription: { ru: row.shortDescriptionRu, kk: row.shortDescriptionKk },
    description: { ru: row.descriptionRu, kk: row.descriptionKk },
    image: row.image,
    gallery: row.gallery,
    maxLoadKg: row.maxLoadKg,
    loadCapacities: row.loadCapacities,
    heights: row.heights,
    widths: row.widths,
    depths: row.depths,
    shelfTypes: row.shelfTypes as ShelfType[],
    minShelves: row.minShelves,
    maxShelves: row.maxShelves,
    useCases: row.useCases,
    markupPercent: toNumber(row.markupPercent),
    markupFixed: toNumber(row.markupFixed),
    sortOrder: row.sortOrder,
    active: row.active,
    featured: row.featured,
    seo: { title: row.seoTitle, description: row.seoDescription },
  };
}

function toDimension(row: {
  id: string;
  value: number;
  label: string;
  priceAdjustment: Prisma.Decimal;
  leadTimeDays: number;
  sortOrder: number;
  active: boolean;
}): DimensionOption {
  return {
    id: row.id,
    value: row.value,
    label: row.label,
    priceAdjustment: toNumber(row.priceAdjustment),
    leadTimeDays: row.leadTimeDays,
    sortOrder: row.sortOrder,
    active: row.active,
    models: [],
  };
}

function toLoadCapacity(
  row: Awaited<ReturnType<typeof prisma.loadCapacityOption.findMany>>[number],
): LoadCapacityOption {
  return {
    id: row.id,
    value: row.value,
    label: row.label,
    models: row.models,
    maxWidth: row.maxWidth,
    maxDepth: row.maxDepth,
    sortOrder: row.sortOrder,
    active: row.active,
    note: row.noteRu ? { ru: row.noteRu, kk: row.noteKk ?? row.noteRu } : undefined,
  };
}

function toComponent(row: Awaited<ReturnType<typeof prisma.component.findMany>>[number]): ShelvingComponent {
  return {
    id: row.id,
    sku: row.sku,
    type: row.type as ComponentType,
    name: { ru: row.nameRu, kk: row.nameKk },
    sellingPrice: toNumber(row.sellingPrice),
    purchasePrice: toNumber(row.purchasePrice),
    weightKg: toNumber(row.weightKg),
    height: row.height ?? undefined,
    width: row.width ?? undefined,
    depth: row.depth ?? undefined,
    loadCapacity: row.loadCapacity ?? undefined,
    shelfType: (row.shelfType as ShelfType | null) ?? undefined,
    variant: row.variant ?? undefined,
    models: row.models,
    colors: row.colors,
    inStock: row.inStock,
    leadTimeDays: row.leadTimeDays,
    supplierRef: row.supplierRef ?? undefined,
    active: row.active,
  };
}

function toRule(row: Awaited<ReturnType<typeof prisma.configurationRule.findMany>>[number]): ConfigurationRule {
  return {
    id: row.id,
    models: row.modelId ? [row.modelId] : [],
    componentType: row.componentType as ComponentType,
    name: row.name,
    formula: row.formula,
    condition: row.condition ?? undefined,
    priority: row.priority,
    active: row.active,
    validFrom: row.validFrom?.toISOString(),
    validUntil: row.validUntil?.toISOString(),
  };
}

function toAccessory(row: Awaited<ReturnType<typeof prisma.accessory.findMany>>[number]): Accessory {
  return {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    name: { ru: row.nameRu, kk: row.nameKk },
    description: { ru: row.descriptionRu, kk: row.descriptionKk },
    image: row.image,
    unitPrice: toNumber(row.unitPrice),
    purchasePrice: toNumber(row.purchasePrice),
    weightKg: toNumber(row.weightKg),
    models: row.models,
    maxQuantityPerSection: row.maxQuantityPerSection ?? undefined,
    inStock: row.inStock,
    sortOrder: row.sortOrder,
    active: row.active,
  };
}

function toColor(row: Awaited<ReturnType<typeof prisma.colorOption.findMany>>[number]): ColorOption {
  return {
    id: row.id,
    name: { ru: row.nameRu, kk: row.nameKk },
    hex: row.hex,
    pricePercent: toNumber(row.pricePercent),
    leadTimeDays: row.leadTimeDays,
    available: row.available,
    sortOrder: row.sortOrder,
  };
}

function toAssembly(row: Awaited<ReturnType<typeof prisma.assemblyService.findMany>>[number]): AssemblyService {
  return {
    id: row.id,
    name: { ru: row.nameRu, kk: row.nameKk },
    description: { ru: row.descriptionRu, kk: row.descriptionKk },
    method: row.method as AssemblyMethod,
    value: toNumber(row.value),
    sortOrder: row.sortOrder,
    active: row.active,
  };
}

function toDelivery(row: Awaited<ReturnType<typeof prisma.deliveryMethod.findMany>>[number]): DeliveryMethod {
  return {
    id: row.id,
    kind: row.kind as DeliveryMethodKind,
    name: { ru: row.nameRu, kk: row.nameKk },
    description: { ru: row.descriptionRu, kk: row.descriptionKk },
    basePrice: row.basePrice === null ? null : toNumber(row.basePrice),
    requiresAddress: row.requiresAddress,
    sortOrder: row.sortOrder,
    active: row.active,
  };
}

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: { images: true; model: { select: { slug: true } } };
}>;

function toProduct(row: ProductWithRelations): CatalogProduct {
  return {
    id: row.id,
    slug: row.slug,
    modelSlug: row.model.slug,
    name: { ru: row.nameRu, kk: row.nameKk },
    description: { ru: row.descriptionRu, kk: row.descriptionKk },
    image: row.images?.[0]?.url ?? '',
    gallery: (row.images ?? []).map((img) => img.url),
    height: row.height,
    width: row.width,
    depth: row.depth,
    shelves: row.shelves,
    loadCapacity: row.loadCapacity,
    sections: row.sections,
    shelfType: row.shelfType as ShelfType,
    color: row.color,
    useCases: row.useCases,
    inStock: row.inStock,
    popularity: row.popularity,
    featured: row.featured,
    published: row.published,
    createdAt: row.createdAt.toISOString(),
    seo: { title: row.seoTitle, description: row.seoDescription },
  };
}

function toPromoCode(row: Awaited<ReturnType<typeof prisma.promoCode.findMany>>[number]): PromoCode {
  return {
    code: row.code,
    discountPercent: toNumber(row.discountPercent),
    discountFixed: toNumber(row.discountFixed),
    minTotal: toNumber(row.minTotal),
    active: row.active,
    validUntil: row.validUntil?.toISOString(),
  };
}

const DEFAULT_PRICE_LEVEL_DISCOUNTS: Record<PriceLevel, number> = {
  RETAIL: 0,
  WHOLESALE: 5,
  DEALER: 10,
  CORPORATE: 3,
  GOVERNMENT: 0,
};

function toPricingSettings(
  row: Awaited<ReturnType<typeof prisma.pricingSettings.findUnique>>,
): PricingSettings {
  if (!row) {
    return {
      vatPercent: 16,
      pricesIncludeVat: false,
      minMarginPercent: 8,
      defaultMarkupPercent: 22,
      currency: 'KZT',
      priceLevelDiscounts: DEFAULT_PRICE_LEVEL_DISCOUNTS,
      quantityBreaks: [],
    };
  }
  return {
    vatPercent: toNumber(row.vatPercent),
    pricesIncludeVat: row.pricesIncludeVat,
    minMarginPercent: toNumber(row.minMarginPercent),
    defaultMarkupPercent: toNumber(row.defaultMarkupPercent),
    currency: row.currency,
    priceLevelDiscounts:
      (row.priceLevelDiscounts as Record<PriceLevel, number>) ?? DEFAULT_PRICE_LEVEL_DISCOUNTS,
    quantityBreaks:
      (row.quantityBreaks as { minQuantity: number; discountPercent: number }[]) ?? [],
  };
}

export async function buildDbCatalog(): Promise<Catalog> {
  const [
    models,
    heights,
    widths,
    depths,
    loadCapacities,
    components,
    rules,
    accessories,
    colors,
    assemblyServices,
    deliveryMethods,
    pricingSettings,
    promoCodes,
    products,
  ] = await Promise.all([
    prisma.productModel.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.heightOption.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.widthOption.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.depthOption.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.loadCapacityOption.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.component.findMany({ where: { active: true } }),
    prisma.configurationRule.findMany({ where: { active: true } }),
    prisma.accessory.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.colorOption.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.assemblyService.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.deliveryMethod.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.pricingSettings.findUnique({ where: { id: 'singleton' } }),
    prisma.promoCode.findMany({ where: { active: true } }),
    prisma.product.findMany({
      where: { published: true },
      include: { images: { orderBy: { sortOrder: 'asc' } }, model: { select: { slug: true } } },
      orderBy: { popularity: 'desc' },
    }),
  ]);

  return {
    models: models.map(toModel),
    heights: heights.map(toDimension),
    widths: widths.map(toDimension),
    depths: depths.map(toDimension),
    loadCapacities: loadCapacities.map(toLoadCapacity),
    components: components.map(toComponent),
    rules: rules.map(toRule),
    accessories: accessories.map(toAccessory),
    colors: colors.map(toColor),
    assemblyServices: assemblyServices.map(toAssembly),
    deliveryMethods: deliveryMethods.map(toDelivery),
    pricingSettings: toPricingSettings(pricingSettings),
    promoCodes: promoCodes.map(toPromoCode),
    products: products.map(toProduct),
    useCases: USE_CASES,
  };
}
