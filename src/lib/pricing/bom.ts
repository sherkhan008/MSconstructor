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
 * Component types priced once for the whole row (uprights, ties, feet,
 * connectors between shared uprights, depth beams, cross braces). None of
 * these depend on an individual section's width, so they are evaluated once
 * against a scope describing the row as a whole — this is exactly where the
 * "shared uprights" saving lives (rule-upright / rule-tie / rule-foot use
 * `sharedUprights` to charge `sections + 1` upright pairs instead of
 * `sections * 4` when the row has more than one section).
 */
const ROW_LEVEL_TYPES: ComponentType[] = ['UPRIGHT', 'TIE', 'FASTENER', 'FOOT', 'CONNECTOR', 'BEAM_DEPTH', 'CROSS_BRACE'];

/**
 * Component types that depend on an individual section's width (shelves,
 * longitudinal beams, wall panels). Evaluated once per section so a row of
 * 700 + 1000 + 1200 mm sections prices each width correctly instead of
 * charging every section as if it were the widest (or narrowest) one.
 */
const SECTION_LEVEL_TYPES: ComponentType[] = ['SHELF', 'BEAM_LONGITUDINAL', 'REAR_WALL', 'SIDE_WALL'];

export interface BomResult {
  lines: BomLine[];
  totalWeightKg: number;
  warnings: string[];
  missingCritical: boolean;
  rowLengthMm: number;
}

/** Row-level scope: describes the whole shelving row, not any one section. */
function buildRowScope(config: ShelvingConfiguration, sharedUprights: 0 | 1): FormulaScope {
  return {
    sections: config.sections.length,
    shelves: config.shelves,
    width: 0,
    depth: config.depth,
    height: config.height,
    quantity: config.quantity,
    loadCapacity: config.loadCapacity,
    rearSolid: 0,
    rearPerforated: 0,
    rearBrace: 0,
    sideCount: 0,
    sidePerforated: 0,
    sharedUprights,
    isRow: sharedUprights,
    shelfReinforced: config.shelfType === 'REINFORCED' || config.shelfType === 'EXTRA_REINFORCED' ? 1 : 0,
  };
}

/** Section-level scope: describes exactly one section (`sections` is always 1). */
function buildSectionScope(config: ShelvingConfiguration, section: ShelvingSection): FormulaScope {
  return {
    sections: 1,
    shelves: config.shelves,
    width: section.width,
    depth: config.depth,
    height: config.height,
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
 * scope and returns the resulting BOM lines. Shared by both the row-level
 * and per-section passes below — never hardcodes a component quantity,
 * every line still comes from a stored formula (src/lib/formula).
 */
function runRules(
  rules: ConfigurationRule[],
  types: ComponentType[],
  scope: FormulaScope,
  config: ShelvingConfiguration,
  catalog: Catalog,
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
        height: config.height,
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
 * shelf a shelf, the frame ties, the bolt/nut sets, the feet and the
 * connectors that join two sections on a shared upright. None of those is a
 * separately purchasable line in the approved list, so charging them again
 * from their own catalog rows would invoice the customer (and cost the
 * business) twice for one supplied part.
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

/** Merges BOM lines that reference the same physical component into one row. */
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
    existing.weightKg += line.weightKg;
  }
  return [...byComponent.values()];
}

/**
 * Builds the bill of materials from the database-driven configuration rules.
 * Row-level components (uprights, ties, feet, connectors, depth beams, cross
 * braces) are priced once for the whole row so the shared-uprights saving is
 * preserved exactly as before. For a model priced from a two-position
 * supplier list the structural helper parts then hand their price ownership
 * to the upright/shelf — see applySupplierKitPriceOwnership; quantities and
 * weights are never affected. Section-level components (shelves,
 * longitudinal beams, wall panels) are priced once per section against that
 * section's own width and wall selection, then aggregated by SKU so the
 * customer-facing BOM shows one row per physical part even when several
 * sections happen to share the same width.
 */
export function buildBom(config: ShelvingConfiguration, catalog: Catalog): BomResult {
  const warnings: string[] = [];
  let missingCritical = false;
  const rawLines: BomLine[] = [];

  const activeRules = catalog.rules;
  const sharedUprights: 0 | 1 = config.sections.length > 1 ? 1 : 0;

  const rowScope = buildRowScope(config, sharedUprights);
  const rowResult = runRules(activeRules, ROW_LEVEL_TYPES, rowScope, config, catalog, undefined);
  rawLines.push(...rowResult.lines);
  warnings.push(...rowResult.warnings);
  missingCritical = missingCritical || rowResult.missingCritical;

  for (const section of config.sections) {
    const sectionScope = buildSectionScope(config, section);
    const sectionResult = runRules(activeRules, SECTION_LEVEL_TYPES, sectionScope, config, catalog, section.width);
    rawLines.push(...sectionResult.lines);
    warnings.push(...sectionResult.warnings);
    missingCritical = missingCritical || sectionResult.missingCritical;
  }

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
  const rowLengthMm = config.sections.reduce((sum, s) => sum + s.width, 0);

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
 * bolted frame (uprights + frame ties + the connectors joining adjacent
 * sections on a shared upright), so beams, frame ties and section connectors
 * are not independent positions in the customer-facing kit composition.
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
