import type { Catalog } from '@/lib/data/repository';
import { findAccessory, findAssembly, findColor, findDelivery, findModel } from '@/lib/data/repository';
import type { CompatibilityIssue, ShelvingConfiguration } from '@/lib/types/domain';

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

  const heightOption = catalog.heights.find((h) => h.value === config.height && h.active);
  if (!heightOption || !model.heights.includes(config.height)) {
    issues.push({ field: 'height', message: `Высота ${config.height} мм недоступна для модели «${model.name.ru}»` });
  }

  for (const section of config.sections) {
    const widthOption = catalog.widths.find((w) => w.value === section.width && w.active);
    if (!widthOption || !model.widths.includes(section.width)) {
      issues.push({
        field: 'sections',
        message: `Ширина ${section.width} мм недоступна для модели «${model.name.ru}»`,
      });
    }
  }

  const depthOption = catalog.depths.find((d) => d.value === config.depth && d.active);
  if (!depthOption || !model.depths.includes(config.depth)) {
    issues.push({ field: 'depth', message: `Глубина ${config.depth} мм недоступна для модели «${model.name.ru}»` });
  }

  if (config.shelves < model.minShelves || config.shelves > model.maxShelves) {
    issues.push({
      field: 'shelves',
      message: `Число полок должно быть от ${model.minShelves} до ${model.maxShelves}`,
    });
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
  }

  return issues;
}
