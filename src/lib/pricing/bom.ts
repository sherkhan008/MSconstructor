import type { Catalog } from '@/lib/data/repository';
import { findAccessory, findComponent } from '@/lib/data/repository';
import { evaluateCondition, evaluateQuantity, FormulaError, type FormulaScope } from '@/lib/formula';
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

  const applicable = rules
    .filter((rule) => types.includes(rule.componentType))
    .filter((rule) => rule.active)
    .filter((rule) => rule.models.length === 0 || rule.models.includes(config.modelSlug))
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
 * preserved exactly as before. Section-level components (shelves,
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

  const lines = aggregateLines(rawLines);

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
export function stripBomCosts(lines: BomLine[]): Omit<BomLine, 'unitCost'>[] {
  return lines.map(({ unitCost: _unitCost, ...rest }) => rest);
}
