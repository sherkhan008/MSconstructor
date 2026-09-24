import type { Tenge } from '@/lib/money';

/* ==========================================================================
   Core domain types shared by the pricing engine, the configurator, the API
   layer and the admin panel. These mirror the Prisma schema one-to-one so the
   in-memory development catalog and the database return identical shapes.
   ========================================================================== */

/** Public locales — the single definition lives in src/lib/i18n/locales.ts. */
export type { Locale } from '@/lib/i18n/locales';

export interface LocalizedText {
  ru: string;
  kk: string;
}

/** Every physically orderable part belongs to one of these families. */
export type ComponentType =
  | 'UPRIGHT'
  | 'SHELF'
  | 'BEAM_LONGITUDINAL'
  | 'BEAM_DEPTH'
  | 'TIE'
  | 'CROSS_BRACE'
  | 'FASTENER'
  | 'FOOT'
  | 'CONNECTOR'
  | 'REAR_WALL'
  | 'SIDE_WALL';

export type ShelfType =
  | 'STANDARD'
  | 'REINFORCED'
  | 'EXTRA_REINFORCED'
  | 'PERFORATED'
  | 'GALVANIZED';

export type AssemblyMethod = 'FIXED' | 'PER_SECTION' | 'PERCENT' | 'INDIVIDUAL';
export type DeliveryMethodKind =
  | 'PICKUP'
  | 'CITY'
  | 'COUNTRY'
  | 'TRANSPORT_COMPANY'
  | 'INDIVIDUAL';

export type CustomerType = 'INDIVIDUAL' | 'LEGAL_ENTITY';
export type PaymentPreference = 'BANK_TRANSFER' | 'BANK_INVOICE' | 'CASH' | 'KASPI_PAY' | 'KASPI_QR';
export type PriceLevel = 'RETAIL' | 'WHOLESALE' | 'DEALER' | 'CORPORATE' | 'GOVERNMENT';

/** The order lifecycle. The allowed steps between these states are not a
 * property of the type — they live in src/lib/orders/status-transitions.ts. */
export type OrderStatus =
  | 'NEW'
  | 'CONFIRMED'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'IN_PROGRESS'
  | 'READY'
  | 'DELIVERED'
  | 'CANCELLED';

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CONTENT_MANAGER';

/* -------------------------------------------------------------------------- */

export interface ProductModel {
  id: string;
  slug: string;
  name: LocalizedText;
  shortDescription: LocalizedText;
  description: LocalizedText;
  image: string;
  gallery: string[];
  maxLoadKg: number;
  loadCapacities: number[];
  heights: number[];
  widths: number[];
  depths: number[];
  shelfTypes: ShelfType[];
  minShelves: number;
  maxShelves: number;
  useCases: string[];
  markupPercent: number;
  markupFixed: Tenge;
  sortOrder: number;
  active: boolean;
  featured: boolean;
  seo: { title: string; description: string };
}

export interface DimensionOption {
  id: string;
  value: number;
  label: string;
  /** Additive adjustment applied once per section, in tenge. */
  priceAdjustment: Tenge;
  leadTimeDays: number;
  sortOrder: number;
  active: boolean;
  /** Empty array = compatible with every model. */
  models: string[];
}

export interface LoadCapacityOption {
  id: string;
  value: number;
  label: string;
  models: string[];
  /** Maximum shelf width (mm) this capacity is certified for. */
  maxWidth: number;
  maxDepth: number;
  sortOrder: number;
  active: boolean;
  note?: LocalizedText;
}

export interface ShelvingComponent {
  id: string;
  sku: string;
  type: ComponentType;
  name: LocalizedText;
  /** Public selling price per unit, in tenge, excluding VAT. */
  sellingPrice: Tenge;
  /** INTERNAL ONLY. Must never be serialised to a public API response. */
  purchasePrice: Tenge;
  weightKg: number;
  /** Matching attributes — undefined means "any". */
  height?: number;
  width?: number;
  depth?: number;
  loadCapacity?: number;
  shelfType?: ShelfType;
  /** Generic sub-type discriminator, e.g. 'SOLID' | 'PERFORATED' for wall panels. */
  variant?: string;
  models: string[];
  colors: string[];
  inStock: boolean;
  leadTimeDays: number;
  supplierRef?: string;
  active: boolean;
}

/** Public-facing projection of a component — purchase price stripped. */
export type PublicComponent = Omit<ShelvingComponent, 'purchasePrice' | 'supplierRef'>;

/** Public-facing projection of a model — the markup that derives the selling
 * price from cost is internal commercial data and never leaves the server. */
export type PublicProductModel = Omit<ProductModel, 'markupPercent' | 'markupFixed'>;

export interface ConfigurationRule {
  id: string;
  /** Empty array = applies to every model. */
  models: string[];
  componentType: ComponentType;
  /** Human label used in the admin rule editor. */
  name: string;
  /** Safe formula evaluated by src/lib/formula. Returns a quantity. */
  formula: string;
  /** Optional guard formula; the rule is skipped when it evaluates falsy. */
  condition?: string;
  priority: number;
  active: boolean;
  validFrom?: string;
  validUntil?: string;
}

export interface Accessory {
  id: string;
  sku: string;
  slug: string;
  name: LocalizedText;
  description: LocalizedText;
  image: string;
  unitPrice: Tenge;
  purchasePrice: Tenge;
  weightKg: number;
  models: string[];
  maxQuantityPerSection?: number;
  inStock: boolean;
  sortOrder: number;
  active: boolean;
}

/** Public-facing projection of an accessory. `unitPrice` is a pre-markup
 * engine input (it is summed into the component subtotal before the model
 * markup is applied), so publishing it next to the public price would let a
 * caller back-calculate the markup. The customer sees accessory cost only
 * inside the server-calculated price. */
export type PublicAccessory = Omit<Accessory, 'purchasePrice' | 'unitPrice'>;

export interface ColorOption {
  id: string;
  name: LocalizedText;
  hex: string;
  /** Percentage surcharge on the component subtotal. */
  pricePercent: number;
  leadTimeDays: number;
  available: boolean;
  sortOrder: number;
}

export interface AssemblyService {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  method: AssemblyMethod;
  /** Meaning depends on `method`: fixed sum, sum per section, or percent. */
  value: number;
  sortOrder: number;
  active: boolean;
}

export interface DeliveryMethod {
  id: string;
  kind: DeliveryMethodKind;
  name: LocalizedText;
  description: LocalizedText;
  /** null = confirmed by a manager (MVP behaviour for most methods). */
  basePrice: Tenge | null;
  requiresAddress: boolean;
  sortOrder: number;
  active: boolean;
}

export interface PricingSettings {
  vatPercent: number;
  /** True when component selling prices already include VAT. */
  pricesIncludeVat: boolean;
  /** Minimum gross margin over purchase cost; discounts may not break it. */
  minMarginPercent: number;
  defaultMarkupPercent: number;
  currency: string;
  priceLevelDiscounts: Record<PriceLevel, number>;
  quantityBreaks: { minQuantity: number; discountPercent: number }[];
}

export interface PromoCode {
  code: string;
  discountPercent: number;
  discountFixed: Tenge;
  minTotal: Tenge;
  active: boolean;
  validUntil?: string;
}

export interface CatalogProduct {
  id: string;
  slug: string;
  modelSlug: string;
  name: LocalizedText;
  description: LocalizedText;
  image: string;
  gallery: string[];
  height: number;
  width: number;
  depth: number;
  shelves: number;
  loadCapacity: number;
  sections: number;
  shelfType: ShelfType;
  color: string;
  useCases: string[];
  inStock: boolean;
  popularity: number;
  featured: boolean;
  published: boolean;
  createdAt: string;
  seo: { title: string; description: string };
}

/* -------------------------------------------------------------------------- */
/* Configuration + pricing result shapes                                       */
/* -------------------------------------------------------------------------- */

export interface ConfigurationAccessorySelection {
  accessoryId: string;
  quantity: number;
  /** Restricts this selection to one specific section — used by accessories
   * that are only valid on a section with a particular width (e.g. the
   * cross brace, real-product-restricted to a 1000mm section). Omitted
   * means the selection applies to the whole row, as every other accessory
   * already did before this field existed. */
  sectionId?: string;
}

/**
 * One physically independent section of the shelving row. Every section owns
 * its own width, height, shelf count and wall panels (Configurator V2.2A).
 * Depth, load capacity, shelf type and colour stay kit-wide — see
 * ShelvingConfiguration.
 *
 * Pricing (V2.2B): every section is priced from its own structural BOM —
 * its own four uprights, never shared with a neighbour — so sections of
 * different heights, shelf counts and widths are priced as built. See
 * buildBom in src/lib/pricing/bom.ts.
 */
export interface ShelvingSection {
  id: string;
  width: number;
  height: number;
  shelves: number;
  rearWall: boolean;
  leftWall: boolean;
  rightWall: boolean;
}

/**
 * The complete, serialisable description of what the customer configured:
 * one shelving row (kit) made of one or more sections. Kit-wide values —
 * model, depth, load capacity, shelf type, colour, kit accessories and
 * quantity — live here; everything that can differ between sections
 * (width, height, shelves, walls) lives on ShelvingSection. There is no
 * row-level height or shelf count. Multi-row layouts are reserved for a
 * future iteration.
 */
export interface ShelvingConfiguration {
  modelSlug: string;
  depth: number;
  sections: ShelvingSection[];
  loadCapacity: number;
  shelfType: ShelfType;
  colorId: string;
  accessories: ConfigurationAccessorySelection[];
  assemblyId: string;
  deliveryId: string;
  quantity: number;
  promoCode?: string;
  priceLevel?: PriceLevel;
  name?: string;
  /** Two of the five customer-facing "Дополнительные параметры" rack
   * options that do not yet have priced catalog/BOM backing (see the task
   * report for src/components/configurator/AdvancedSettingsAccordion.tsx).
   * Plain configuration flags, not accessories — they persist real customer
   * intent without going through accessory-catalog compatibility validation
   * or fabricating a price. Undefined behaves as false (legacy configs). */
  metalFootPad?: boolean;
  shelfCornerBrackets?: boolean;
}

export interface BomLine {
  componentId: string;
  sku: string;
  type: ComponentType | 'ACCESSORY';
  name: string;
  quantity: number;
  unitPrice: Tenge;
  totalPrice: Tenge;
  weightKg: number;
  /** Internal cost — populated server-side only, stripped from public output. */
  unitCost?: Tenge;
}

export interface PriceBreakdown {
  componentsSubtotal: Tenge;
  colorSurcharge: Tenge;
  markup: Tenge;
  unitNet: Tenge;
  quantity: number;
  itemsNet: Tenge;
  assembly: Tenge;
  delivery: Tenge | null;
  discount: Tenge;
  discountReasons: string[];
  net: Tenge;
  vatPercent: number;
  vat: Tenge;
  total: Tenge;
  /** Per-unit gross price shown on cards and in the cart. */
  unitTotal: Tenge;
}

export interface PriceResult {
  ok: true;
  configuration: ShelvingConfiguration;
  bom: BomLine[];
  breakdown: PriceBreakdown;
  totalWeightKg: number;
  rowLengthMm: number;
  leadTimeDays: number;
  deliveryNote: string | null;
  /**
   * Customer-facing notices, written in commercial language: they are
   * projected verbatim to the browser by toPublicPriceResult() and rendered
   * in the configurator. Nothing here may name an internal commercial
   * concept (markup, margin, cost, price-level enum, BOM rule) — see
   * `internalWarnings` for those.
   */
  warnings: string[];
  /**
   * Server-only diagnostics: missing BOM components, formula failures and
   * the margin floor that capped a discount. Useful to admin/support and to
   * logs, never to a customer — the public projection is an allow-list
   * (src/lib/pricing/public-result.ts) and deliberately omits this field.
   */
  internalWarnings: string[];
}

export interface PriceFailure {
  ok: false;
  code: PricingErrorCode;
  message: string;
  /** Customer-facing detail lines; same language rules as PriceResult.warnings. */
  details?: string[];
  /** Server-only diagnostics; same rules as PriceResult.internalWarnings. */
  internalDetails?: string[];
}

export type PricingOutcome = PriceResult | PriceFailure;

export type PricingErrorCode =
  | 'UNKNOWN_MODEL'
  | 'INCOMPATIBLE_CONFIGURATION'
  | 'MISSING_COMPONENT'
  | 'INVALID_FORMULA'
  | 'VALIDATION_ERROR'
  | 'INDIVIDUAL_QUOTE_REQUIRED';

export interface CompatibilityIssue {
  field: keyof ShelvingConfiguration | 'general';
  message: string;
}
