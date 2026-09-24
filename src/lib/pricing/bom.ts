import type { Catalog } from '@/lib/data/repository';
import { findAccessory, findComponent } from '@/lib/data/repository';
import { evaluateCondition, evaluateQuantity, FormulaError, type FormulaScope } from '@/lib/formula';
import { roundTenge } from '@/lib/money';
import type { BomLine, ComponentType, ConfigurationRule, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';

/** Component types whose absence means the configuration cannot be built at all. */
const CRITICAL_COMPONENT_TYPES: ComponentType[] = [
  'UPRIGHT',
  'SHELF',
  'BEAM_LONGITUDINAL',
  'BEAM_DEPTH',
];

/**
 * The frame of one section: uprights, frame ties, bolt/nut sets, feet,
 * connectors, depth beams and cross braces. None of these parts has a width
 * of its own, so they are looked up by the section's height (and the shared
 * depth) with no width — exactly as they always were.
 */
const FRAME_TYPES: ComponentType[] = ['UPRIGHT', 'TIE', 'FASTENER', 'FOOT', 'CONNECTOR', 'BEAM_DEPTH', 'CROSS_BRACE'];

/**
 * The width-dependent parts of one section: shelves, longitudinal beams and
 * wall panels, looked up by that section's own width as well.
 */
const WIDTH_TYPES: ComponentType[] = ['SHELF', 'BEAM_LONGITUDINAL', 'REAR_WALL', 'SIDE_WALL'];

export interface BomResult {
  lines: BomLine[];
  totalWeightKg: number;
  /**
   * Server-only diagnostics. They name the internal configuration rule and
   * the component that failed to resolve, which is meaningless to a customer
   * and describes how the kit is assembled internally — calculatePrice()
   * routes them to PriceResult.internalWarnings / PriceFailure.internalDetails,
   * never to the customer-facing channel.
   */
  warnings: string[];
  missingCritical: boolean;
  rowLengthMm: number;
}

/**
 * The formula scope of ONE physically independent section (Configurator
 * V2.2B): `sections` is always 1 and every value is that section's own —
 * width, height, shelf count, wall panels — plus the kit-wide depth, load
 * capacity, shelf type and quantity.
 *
 * `sharedUprights` and `isRow` are always 0. Adjacent sections never share
 * an upright: each one stands on its own four, so every stored rule is read
 * through its independent-section branch (rule-upright
 * `sharedUprights == 1 ? … : sections * 4` → 4 uprights per section,
 * rule-connector → none). The variables stay in the scope only so the
 * formulas stored in the database keep evaluating unchanged.
 */
function buildSectionScope(config: ShelvingConfiguration, section: ShelvingSection): FormulaScope {
  return {
    sections: 1,
    shelves: section.shelves,
    width: section.width,
    depth: config.depth,
    height: section.height,
    quantity: config.quantity,
    loadCapacity: config.loadCapacity,
    rearSolid: section.rearWall ? 1 : 0,
    rearPerforated: 0,
    rearBrace: 0,
    sideCount: (section.leftWall ? 1 : 0) + (section.rightWall ? 1 : 0),
    sidePerforated: 0,
    sharedUprights: 0,
    isRow: 0,
    shelfReinforced: config.shelfType === 'REINFORCED' || config.shelfType === 'EXTRA_REINFORCED' ? 1 : 0,
  };
}

/** Wall panels only ever come in the solid variant in this iteration — see WallsSection UI. */
function wallVariant(): string {
  return 'SOLID';
}

/**
 * Evaluates every active, applicable rule of the given types against one
 * section's scope and returns the resulting BOM lines. Used for both the
 * frame and the width-dependent pass of buildSectionBom — never hardcodes a
 * component quantity, every line still comes from a stored formula
 * (src/lib/formula).
 */
function runRules(
  rules: ConfigurationRule[],
  types: ComponentType[],
  scope: FormulaScope,
  config: ShelvingConfiguration,
  catalog: Catalog,
  height: number,
  width: number | undefined,
): { lines: BomLine[]; warnings: string[]; missingCritical: boolean } {
  const lines: BomLine[] = [];
  const warnings: string[] = [];
  let missingCritical = false;

  const matching = rules
    .filter((rule) => types.includes(rule.componentType))
    .filter((rule) => rule.active)
    .filter((rule) => rule.models.length === 0 || rule.models.includes(config.modelSlug));

  // A rule scoped to this model replaces the generic (all-model) rules for
  // the same component type, so a model-specific quantity formula (e.g.
  // rule-fastener-ms-standard) is never charged on top of the generic one.
  const modelSpecificTypes = new Set(matching.filter((rule) => rule.models.length > 0).map((rule) => rule.componentType));
  const applicable = matching
    .filter((rule) => rule.models.length > 0 || !modelSpecificTypes.has(rule.componentType))
    .sort((a, b) => a.priority - b.priority);

  for (const rule of applicable) {
    try {
      if (rule.condition && !evaluateCondition(rule.condition, scope)) continue;

      const quantity = evaluateQuantity(rule.formula, scope);
      if (quantity <= 0) continue;

      const component = findComponent(catalog, {
        type: rule.componentType,
        modelSlug: config.modelSlug,
        height,
        width,
        depth: config.depth,
        loadCapacity: config.loadCapacity,
        shelfType: config.shelfType,
        variant: rule.componentType === 'REAR_WALL' || rule.componentType === 'SIDE_WALL' ? wallVariant() : undefined,
      });

      if (!component) {
        if (CRITICAL_COMPONENT_TYPES.includes(rule.componentType)) {
          missingCritical = true;
        }
        warnings.push(`Не найден компонент для правила «${rule.name}»`);
        continue;
      }

      lines.push({
        componentId: component.id,
        sku: component.sku,
        type: component.type,
        name: component.name.ru,
        quantity,
        unitPrice: component.sellingPrice,
        totalPrice: component.sellingPrice * quantity,
        weightKg: component.weightKg * quantity,
        unitCost: component.purchasePrice,
      });
    } catch (error) {
      const message = error instanceof FormulaError ? error.message : 'Ошибка расчёта правила';
      warnings.push(`Правило «${rule.name}»: ${message}`);
    }
  }

  return { lines, warnings, missingCritical };
}

/**
 * Models whose whole commercial price comes from an approved supplier price
 * list that quotes ONLY the upright and the ordinary shelf.
 *
 * MS Standard is bought from the supplier as exactly two commercial
 * positions — «Стойка ST MS-750» and «Полка ST MP-750» — and the price of
 * each already covers everything that ships with it: the beams that make the
 * shelf a shelf, the frame ties, the bolt/nut sets, the feet and any
 * section connectors. None of those is a separately purchasable line in the
 * approved list, so charging them again from their own catalog rows would
 * invoice the customer (and cost the business) twice for one supplied part.
 *
 * Scoped by model slug on purpose: MS Strong and Archive MS are not priced
 * from that list and keep every component's own selling price and cost
 * exactly as before.
 */
const SUPPLIER_PRICED_KIT_MODELS: ReadonlySet<string> = new Set(['ms-standard']);

/**
 * The structural helper parts of a SUPPLIER_PRICED_KIT_MODELS rack whose
 * commercial value is already inside the upright/shelf price above.
 *
 * Only the two money fields and the unit cost are cleared. The line itself,
 * its component id, SKU, name, quantity and weight all stay exactly as the
 * configuration rules built them, because production, packing lists, order
 * history and the weight/delivery calculation all still need to know that a
 * rack contains 20 beams and 48 bolts — it is only the *price ownership*
 * that moves to the upright and the shelf.
 */
const INCLUDED_IN_SUPPLIER_KIT_PRICE: ReadonlySet<BomLine['type']> = new Set([
  'BEAM_LONGITUDINAL',
  'BEAM_DEPTH',
  'TIE',
  'FASTENER',
  'FOOT',
  'CONNECTOR',
]);

/**
 * Applies the ownership rule above to the structural part of a BOM. Returns
 * the lines unchanged for every model that is not priced from a two-position
 * supplier list, and never touches accessories, wall panels or any other
 * genuinely customer-selected paid option (those are appended after this
 * runs — see buildBom).
 */
function applySupplierKitPriceOwnership(lines: BomLine[], modelSlug: string): BomLine[] {
  if (!SUPPLIER_PRICED_KIT_MODELS.has(modelSlug)) return lines;
  return lines.map((line) =>
    INCLUDED_IN_SUPPLIER_KIT_PRICE.has(line.type)
      ? { ...line, unitPrice: 0, totalPrice: 0, unitCost: 0 }
      : line,
  );
}

/**
 * Merges BOM lines that reference the same catalog component into one row:
 * quantity, total price and weight are summed; the unit price and unit cost
 * are the component's own and therefore identical on every merged line.
 * Lines of different components are never merged, so different upright
 * heights or shelf widths stay separate rows. Insertion order is kept.
 */
function aggregateLines(lines: BomLine[]): BomLine[] {
  const byComponent = new Map<string, BomLine>();
  for (const line of lines) {
    const existing = byComponent.get(line.componentId);
    if (!existing) {
      byComponent.set(line.componentId, { ...line });
      continue;
    }
    existing.quantity += line.quantity;
    existing.totalPrice += line.totalPrice;
    // Summing per-section weights accumulates binary floating-point noise
    // (5 × 2.4 kg = 12.000000000000002); a milligram grid removes it without
    // moving any real value.
    existing.weightKg = Math.round((existing.weightKg + line.weightKg) * 1e6) / 1e6;
  }
  return [...byComponent.values()];
}

/** The structural BOM of one physically independent section, before aggregation. */
export interface SectionBom {
  sectionId: string;
  /** Uprights, ties, fasteners, feet, depth beams… — looked up by this section's height. */
  frameLines: BomLine[];
  /** Shelves, longitudinal beams, wall panels — looked up by this section's width too. */
  widthLines: BomLine[];
  warnings: string[];
  missingCritical: boolean;
}

/**
 * The structural BOM of ONE section, from that section's own width, height,
 * shelf count and wall panels plus the kit-wide depth, load capacity and
 * shelf type (Configurator V2.2B). Sections are physically independent:
 * nothing here depends on a neighbour, so a section prices the same wherever
 * it stands in the row. Quantities come only from the stored rules evaluated
 * with buildSectionScope; unit prices only from the catalog component each
 * rule resolves to. Model-level price ownership (applySupplierKitPriceOwnership)
 * and accessories are applied once to the whole kit by buildBom.
 */
export function buildSectionBom(config: ShelvingConfiguration, section: ShelvingSection, catalog: Catalog): SectionBom {
  const scope = buildSectionScope(config, section);
  const frame = runRules(catalog.rules, FRAME_TYPES, scope, config, catalog, section.height, undefined);
  const width = runRules(catalog.rules, WIDTH_TYPES, scope, config, catalog, section.height, section.width);
  return {
    sectionId: section.id,
    frameLines: frame.lines,
    widthLines: width.lines,
    warnings: [...frame.warnings, ...width.warnings],
    missingCritical: frame.missingCritical || width.missingCritical,
  };
}

/**
 * Builds the bill of materials from the database-driven configuration rules
 * (Configurator V2.2B — independent sections).
 *
 *   1. Every section gets its own structural BOM (buildSectionBom) from its
 *      own width, height, shelves and walls: its own four uprights, its own
 *      frame ties, feet and fasteners, its own shelves and beams. Adjacent
 *      sections never share an upright, so a row of N sections carries
 *      N × the per-section upright quantity — there is no row-level pass and
 *      no row-wide height or shelf count, so sections of different heights
 *      or shelf counts are each priced exactly as built.
 *   2. The section BOMs are merged by catalog component (aggregateLines):
 *      identical parts become one line whose quantity, price and weight are
 *      the sums of the sections' own lines, while parts that differ (a 1500 mm
 *      and a 2500 mm upright, a 1000 and a 1200 shelf) stay separate lines.
 *      Frame lines come first, then shelves/beams/walls, in row order.
 *   3. For a model priced from a two-position supplier list the structural
 *      helper parts hand their price ownership to the upright/shelf
 *      (applySupplierKitPriceOwnership); quantities and weights are never
 *      affected.
 *   4. Accessories are appended as their own paid lines.
 */
export function buildBom(config: ShelvingConfiguration, catalog: Catalog): BomResult {
  const warnings: string[] = [];
  let missingCritical = false;

  const rowLengthMm = config.sections.reduce((sum, s) => sum + s.width, 0);

  const sectionBoms = config.sections.map((section) => buildSectionBom(config, section, catalog));
  for (const sectionBom of sectionBoms) {
    warnings.push(...sectionBom.warnings);
    missingCritical = missingCritical || sectionBom.missingCritical;
  }
  const rawLines = [...sectionBoms.flatMap((s) => s.frameLines), ...sectionBoms.flatMap((s) => s.widthLines)];

  const lines = applySupplierKitPriceOwnership(aggregateLines(rawLines), config.modelSlug);

  for (const selection of config.accessories) {
    const accessory = findAccessory(catalog, selection.accessoryId);
    if (!accessory) continue;
    lines.push({
      componentId: accessory.id,
      sku: accessory.sku,
      type: 'ACCESSORY',
      name: accessory.name.ru,
      quantity: selection.quantity,
      unitPrice: accessory.unitPrice,
      totalPrice: accessory.unitPrice * selection.quantity,
      weightKg: accessory.weightKg * selection.quantity,
      unitCost: accessory.purchasePrice,
    });
  }

  const totalWeightKg = Math.round(lines.reduce((sum, line) => sum + line.weightKg, 0) * 10) / 10;

  return { lines, totalWeightKg, warnings, missingCritical, rowLengthMm };
}

/** Public projection of a BOM — strips internal purchase cost. */
export function stripBomCosts(lines: BomLine[]): PublicBomLine[] {
  return lines.map(({ unitCost: _unitCost, ...rest }) => rest);
}

/** A BOM line as a customer may see it — internal cost removed. */
export type PublicBomLine = Omit<BomLine, 'unitCost'>;

/**
 * Structural parts a customer never orders as their own kit position: the
 * shelf is supplied as one complete shelf assembly (shelf + its beams) on a
 * bolted frame (uprights + frame ties + any section connectors), so beams,
 * frame ties and section connectors are not independent positions in the
 * customer-facing kit composition.
 *
 * This is presentation only. The internal BOM built above keeps every one of
 * these as a real line with its own quantity and weight — the authoritative
 * price, cost, margin floor and weight in src/lib/pricing/engine.ts are all
 * computed from that internal BOM and are untouched by this projection. Each
 * hidden line is folded into the assembly line it physically belongs to, so
 * the public rows still sum to the exact same componentsSubtotal and total
 * weight; hiding a row must never make the kit look cheaper than it is
 * priced. (For a supplier-priced kit model the folded amount is zero by
 * construction — see applySupplierKitPriceOwnership — which keeps that sum
 * exact for the same reason.)
 */
const PUBLIC_ASSEMBLY_OF: Partial<Record<BomLine['type'], BomLine['type']>> = {
  BEAM_LONGITUDINAL: 'SHELF',
  BEAM_DEPTH: 'SHELF',
  TIE: 'UPRIGHT',
  CONNECTOR: 'UPRIGHT',
};

/**
 * Models actually sold as one complete shelf assembly, and therefore the
 * only ones whose customer-facing kit hides the parts above. The public
 * pricing endpoint accepts any catalog model slug the client sends (the
 * configurator page offers ms-standard only, but /api/pricing/calculate
 * happily prices ms-strong and archive-ms), so this grouping is scoped
 * explicitly rather than left to apply to whatever model is submitted —
 * ms-strong sells beams as their own load-bearing positions.
 */
const ONE_PIECE_ASSEMBLY_MODELS: ReadonlySet<string> = new Set(['ms-standard']);

/**
 * Customer-facing projection of a BOM: strips internal cost (stripBomCosts)
 * and, for the models in ONE_PIECE_ASSEMBLY_MODELS, folds the structural
 * parts listed in PUBLIC_ASSEMBLY_OF into the assembly they ship as part of.
 * Use this for every customer-visible BOM; internal/admin output keeps the
 * full component-level detail.
 *
 * Folding only ever moves price and weight onto an existing line: the SKU,
 * name, component id and quantity of every surviving row stay exactly as the
 * BOM built them, and two shelf SKUs are never merged into one row. When a
 * row has several shelf widths (so several SHELF lines), the folded amount
 * lands on the first matching line — the customer-facing list shows name and
 * quantity only, and the row total is what has to stay exact.
 */
export function toPublicBom(lines: BomLine[], modelSlug: string): PublicBomLine[] {
  const stripped = stripBomCosts(lines);
  if (!ONE_PIECE_ASSEMBLY_MODELS.has(modelSlug)) return stripped;

  const visible: PublicBomLine[] = [];
  const hidden: PublicBomLine[] = [];

  for (const line of stripped) {
    (PUBLIC_ASSEMBLY_OF[line.type] ? hidden : visible).push(line);
  }

  for (const line of hidden) {
    const host = visible.find((candidate) => candidate.type === PUBLIC_ASSEMBLY_OF[line.type]);
    if (!host) {
      // The assembly this part belongs to is missing from the BOM entirely
      // (already a failed, unsellable configuration — buildBom reports it as
      // missingCritical). Keep the row rather than silently drop its price.
      visible.push(line);
      continue;
    }
    host.totalPrice += line.totalPrice;
    host.weightKg += line.weightKg;
    host.unitPrice = roundTenge(host.totalPrice / host.quantity);
  }

  return visible;
}
