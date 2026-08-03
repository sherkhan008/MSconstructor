import type { Catalog } from '@/lib/data/repository';
import { findAccessory, findComponent } from '@/lib/data/repository';
import { evaluateCondition, evaluateQuantity, FormulaError, type FormulaScope } from '@/lib/formula';
import type { BomLine, ComponentType, ShelvingConfiguration } from '@/lib/types/domain';

/** Component types whose absence means the configuration cannot be built at all. */
const CRITICAL_COMPONENT_TYPES: ComponentType[] = [
  'UPRIGHT',
  'SHELF',
  'BEAM_LONGITUDINAL',
  'BEAM_DEPTH',
];

export interface BomResult {
  lines: BomLine[];
  totalWeightKg: number;
  warnings: string[];
  missingCritical: boolean;
  rowLengthMm: number;
}

/** Translates a configuration into the numeric scope formulas evaluate against. */
export function buildFormulaScope(config: ShelvingConfiguration): FormulaScope {
  const sharedUprights =
    config.configurationType === 'STARTER_WITH_EXTENSIONS' || config.configurationType === 'CONTINUOUS_ROW'
      ? 1
      : 0;

  return {
    sections: config.sections,
    shelves: config.shelves,
    width: config.width,
    depth: config.depth,
    height: config.height,
    quantity: config.quantity,
    loadCapacity: config.loadCapacity,
    rearSolid: config.rear === 'SOLID' ? 1 : 0,
    rearPerforated: config.rear === 'PERFORATED' ? 1 : 0,
    rearBrace: config.rear === 'CROSS_BRACE' ? 1 : 0,
    sideCount: config.side === 'NONE' ? 0 : config.side.startsWith('BOTH') ? 2 : 1,
    sidePerforated: config.side.includes('PERFORATED') ? 1 : 0,
    sharedUprights,
    isRow: config.configurationType === 'CONTINUOUS_ROW' ? 1 : 0,
    shelfReinforced: config.shelfType === 'REINFORCED' || config.shelfType === 'EXTRA_REINFORCED' ? 1 : 0,
  };
}

function wallVariant(config: ShelvingConfiguration, kind: 'rear' | 'side'): string | undefined {
  if (kind === 'rear') {
    if (config.rear === 'SOLID') return 'SOLID';
    if (config.rear === 'PERFORATED') return 'PERFORATED';
    return undefined;
  }
  return config.side.includes('PERFORATED') ? 'PERFORATED' : 'SOLID';
}

/**
 * Builds the bill of materials from the database-driven configuration rules.
 * Never hardcodes a component quantity — every line comes from evaluating a
 * stored formula (src/lib/formula) against the scope derived from the
 * customer's selections.
 */
export function buildBom(config: ShelvingConfiguration, catalog: Catalog): BomResult {
  const lines: BomLine[] = [];
  const warnings: string[] = [];
  let missingCritical = false;
  const scope = buildFormulaScope(config);

  const applicableRules = catalog.rules
    .filter((rule) => rule.active)
    .filter((rule) => rule.models.length === 0 || rule.models.includes(config.modelSlug))
    .sort((a, b) => a.priority - b.priority);

  for (const rule of applicableRules) {
    try {
      if (rule.condition && !evaluateCondition(rule.condition, scope)) continue;

      const quantity = evaluateQuantity(rule.formula, scope);
      if (quantity <= 0) continue;

      const component = findComponent(catalog, {
        type: rule.componentType,
        modelSlug: config.modelSlug,
        height: config.height,
        width: config.width,
        depth: config.depth,
        loadCapacity: config.loadCapacity,
        shelfType: config.shelfType,
        variant:
          rule.componentType === 'REAR_WALL'
            ? wallVariant(config, 'rear')
            : rule.componentType === 'SIDE_WALL'
              ? wallVariant(config, 'side')
              : undefined,
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
  const rowLengthMm =
    config.configurationType === 'STARTER_WITH_EXTENSIONS' || config.configurationType === 'CONTINUOUS_ROW'
      ? config.width * config.sections
      : config.width;

  return { lines, totalWeightKg, warnings, missingCritical, rowLengthMm };
}

/** Public projection of a BOM — strips internal purchase cost. */
export function stripBomCosts(lines: BomLine[]): Omit<BomLine, 'unitCost'>[] {
  return lines.map(({ unitCost: _unitCost, ...rest }) => rest);
}
