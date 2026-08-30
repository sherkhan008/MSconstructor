import type { Catalog } from '@/lib/data/repository';
import { findAccessory, findAssembly, findColor, findDelivery, findModel } from '@/lib/data/repository';
import type { CompatibilityIssue, ShelvingConfiguration } from '@/lib/types/domain';
import { isValidMsStandardConfiguration } from './ms-standard-compatibility';

/**
 * Server-side compatibility validation. The configurator UI disables
 * incompatible options proactively, but this is the authoritative check —
 * every price calculation, cart addition and order submission runs through
 * it again, because client state can never be trusted.
 */
export function validateCompatibility(
  config: ShelvingConfiguration,
  catalog: Catalog,
): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];

  const model = findModel(catalog, config.modelSlug);
  if (!model) {
    issues.push({ field: 'modelSlug', message: 'Выбранная модель недоступна' });
    return issues;
  }

  // The GLOBAL dimension row must exist and be active regardless of model —
  // an admin deactivating a HeightOption/WidthOption/DepthOption row blocks
  // it everywhere, independent of whichever model-specific rules run below.
  const heightOption = catalog.heights.find((h) => h.value === config.height && h.active);
  if (!heightOption) {
    issues.push({ field: 'height', message: `Высота ${config.height} мм недоступна` });
  }
  for (const section of config.sections) {
    const widthOption = catalog.widths.find((w) => w.value === section.width && w.active);
    if (!widthOption) {
      issues.push({ field: 'sections', message: `Ширина ${section.width} мм недоступна` });
    }
  }
  const depthOption = catalog.depths.find((d) => d.value === config.depth && d.active);
  if (!depthOption) {
    issues.push({ field: 'depth', message: `Глубина ${config.depth} мм недоступна` });
  }

  if (model.slug === 'ms-standard') {
    // The authoritative MS Standard matrix — cross-dimensional rules (which
    // depths a section width supports, which heights allow how many
    // shelves) that a flat ProductModel.heights/widths/depths list cannot
    // express. Single source of truth shared with the customer UI's
    // dimension selects, width/height drag allowedValues, and editable-state
    // normalization — see ms-standard-compatibility.ts.
    for (const issue of isValidMsStandardConfiguration(config)) {
      issues.push({ field: issue.field, message: issue.message });
    }
  } else {
    // Every other model still uses its own flat per-model lists — no
    // cross-dimensional rules exist for them today.
    if (!model.heights.includes(config.height)) {
      issues.push({ field: 'height', message: `Высота ${config.height} мм недоступна для модели «${model.name.ru}»` });
    }
    for (const section of config.sections) {
      if (!model.widths.includes(section.width)) {
        issues.push({
          field: 'sections',
          message: `Ширина ${section.width} мм недоступна для модели «${model.name.ru}»`,
        });
      }
    }
    if (!model.depths.includes(config.depth)) {
      issues.push({ field: 'depth', message: `Глубина ${config.depth} мм недоступна для модели «${model.name.ru}»` });
    }
    if (config.shelves < model.minShelves || config.shelves > model.maxShelves) {
      issues.push({
        field: 'shelves',
        message: `Число полок должно быть от ${model.minShelves} до ${model.maxShelves}`,
      });
    }
  }

  if (!model.shelfTypes.includes(config.shelfType)) {
    issues.push({ field: 'shelfType', message: `Тип полки недоступен для модели «${model.name.ru}»` });
  }

  const loadOption = catalog.loadCapacities.find((l) => l.value === config.loadCapacity && l.active);
  if (!loadOption || !model.loadCapacities.includes(config.loadCapacity)) {
    issues.push({ field: 'loadCapacity', message: `Нагрузка ${config.loadCapacity} кг недоступна для модели «${model.name.ru}»` });
  } else {
    if (loadOption.models.length > 0 && !loadOption.models.includes(model.slug)) {
      issues.push({ field: 'loadCapacity', message: `Нагрузка ${config.loadCapacity} кг недоступна для модели «${model.name.ru}»` });
    }
    if (config.sections.some((s) => s.width > loadOption.maxWidth)) {
      issues.push({
        field: 'loadCapacity',
        message: `Нагрузка ${config.loadCapacity} кг доступна только при ширине секции до ${loadOption.maxWidth} мм`,
      });
    }
    if (config.depth > loadOption.maxDepth) {
      issues.push({
        field: 'loadCapacity',
        message: `Нагрузка ${config.loadCapacity} кг доступна только при глубине до ${loadOption.maxDepth} мм`,
      });
    }
  }

  const color = findColor(catalog, config.colorId);
  if (!color) {
    issues.push({ field: 'colorId', message: 'Выбранный цвет недоступен' });
  }

  const assembly = findAssembly(catalog, config.assemblyId);
  if (!assembly) {
    issues.push({ field: 'assemblyId', message: 'Выбранный вариант сборки недоступен' });
  }

  const delivery = findDelivery(catalog, config.deliveryId);
  if (!delivery) {
    issues.push({ field: 'deliveryId', message: 'Выбранный способ доставки недоступен' });
  }

  for (const selection of config.accessories) {
    const accessory = findAccessory(catalog, selection.accessoryId);
    if (!accessory) {
      issues.push({ field: 'accessories', message: 'Один из выбранных аксессуаров недоступен' });
      continue;
    }
    if (accessory.models.length > 0 && !accessory.models.includes(model.slug)) {
      issues.push({
        field: 'accessories',
        message: `Аксессуар «${accessory.name.ru}» недоступен для модели «${model.name.ru}»`,
      });
    }
    if (
      accessory.maxQuantityPerSection &&
      selection.quantity > accessory.maxQuantityPerSection * config.sections.length
    ) {
      issues.push({
        field: 'accessories',
        message: `Максимальное количество «${accessory.name.ru}» — ${accessory.maxQuantityPerSection} на секцию`,
      });
    }
    // The real product's cross brace only fits a 1000mm section — this is a
    // per-section restriction (a row can mix a 1000mm section with others),
    // so it must name the specific section, not just "some section in the
    // row is 1000mm". Authoritative here because client state is untrusted;
    // the configurator UI enforces the same rule proactively.
    if (accessory.id === 'acc-cross-brace') {
      const section = selection.sectionId ? config.sections.find((s) => s.id === selection.sectionId) : undefined;
      if (!section || section.width !== 1000) {
        issues.push({
          field: 'accessories',
          message: 'Крестовина жёсткости доступна только для секции шириной 1000 мм',
        });
      }
    }
  }

  return issues;
}
