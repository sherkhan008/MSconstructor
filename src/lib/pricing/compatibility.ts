import type { Catalog } from '@/lib/data/repository';
import { findAccessory, findAssembly, findColor, findDelivery, findModel } from '@/lib/data/repository';
import type { CompatibilityIssue, ShelvingConfiguration } from '@/lib/types/domain';
import { isValidMsStandardConfiguration } from './ms-standard-compatibility';
import type { Locale } from '@/lib/i18n/locales';
import { pick, t } from '@/lib/i18n/format';
import { ER } from '@/lib/i18n/strings';

/**
 * Server-side compatibility validation. The configurator UI disables
 * incompatible options proactively, but this is the authoritative check —
 * every price calculation, cart addition and order submission runs through
 * it again, because client state can never be trusted.
 *
 * `locale` only selects the language of the customer-facing messages
 * (owner-reviewed CSV rows ER-035…ER-057); every rule is locale-independent.
 */
export function validateCompatibility(
  config: ShelvingConfiguration,
  catalog: Catalog,
  locale: Locale = 'ru',
): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];

  const model = findModel(catalog, config.modelSlug);
  if (!model) {
    issues.push({ field: 'modelSlug', message: t(ER['ER-035'], locale) });
    return issues;
  }
  const modelName = pick(model.name, locale);

  // The GLOBAL dimension row must exist and be active regardless of model —
  // an admin deactivating a HeightOption/WidthOption/DepthOption row blocks
  // it everywhere, independent of whichever model-specific rules run below.
  // Heights are per section (V2.2A): each distinct section height must be
  // an active row; a height shared by several sections is reported once.
  const sectionHeights = [...new Set(config.sections.map((s) => s.height))];
  for (const height of sectionHeights) {
    const heightOption = catalog.heights.find((h) => h.value === height && h.active);
    if (!heightOption) {
      issues.push({ field: 'sections', message: t(ER['ER-036'], locale, { H: height }) });
    }
  }
  for (const section of config.sections) {
    const widthOption = catalog.widths.find((w) => w.value === section.width && w.active);
    if (!widthOption) {
      issues.push({ field: 'sections', message: t(ER['ER-037'], locale, { W: section.width }) });
    }
  }
  const depthOption = catalog.depths.find((d) => d.value === config.depth && d.active);
  if (!depthOption) {
    issues.push({ field: 'depth', message: t(ER['ER-038'], locale, { D: config.depth }) });
  }

  if (model.slug === 'ms-standard') {
    // The authoritative MS Standard matrix — cross-dimensional rules (which
    // depths a section width supports, how many shelves each section's own
    // height allows) that a flat ProductModel.heights/widths/depths list cannot
    // express. Single source of truth shared with the customer UI's
    // dimension selects, width/height drag allowedValues, and editable-state
    // normalization — see ms-standard-compatibility.ts.
    for (const issue of isValidMsStandardConfiguration(config, locale)) {
      issues.push({ field: issue.field, message: issue.message });
    }
  } else {
    // Every other model still uses its own flat per-model lists — no
    // cross-dimensional rules exist for them today.
    for (const height of sectionHeights) {
      if (!model.heights.includes(height)) {
        issues.push({ field: 'sections', message: t(ER['ER-039'], locale, { H: height, model: modelName }) });
      }
    }
    for (const section of config.sections) {
      if (!model.widths.includes(section.width)) {
        issues.push({
          field: 'sections',
          message: t(ER['ER-040'], locale, { W: section.width, model: modelName }),
        });
      }
    }
    if (!model.depths.includes(config.depth)) {
      issues.push({ field: 'depth', message: t(ER['ER-041'], locale, { D: config.depth, model: modelName }) });
    }
    if (config.sections.some((s) => s.shelves < model.minShelves || s.shelves > model.maxShelves)) {
      issues.push({
        field: 'sections',
        message: t(ER['ER-042'], locale, { min: model.minShelves, max: model.maxShelves }),
      });
    }
  }

  if (!model.shelfTypes.includes(config.shelfType)) {
    issues.push({ field: 'shelfType', message: t(ER['ER-043'], locale, { model: modelName }) });
  }

  const loadOption = catalog.loadCapacities.find((l) => l.value === config.loadCapacity && l.active);
  if (!loadOption || !model.loadCapacities.includes(config.loadCapacity)) {
    issues.push({ field: 'loadCapacity', message: t(ER['ER-044'], locale, { N: config.loadCapacity, model: modelName }) });
  } else {
    if (loadOption.models.length > 0 && !loadOption.models.includes(model.slug)) {
      issues.push({ field: 'loadCapacity', message: t(ER['ER-044'], locale, { N: config.loadCapacity, model: modelName }) });
    }
    if (config.sections.some((s) => s.width > loadOption.maxWidth)) {
      issues.push({
        field: 'loadCapacity',
        message: t(ER['ER-045'], locale, { N: config.loadCapacity, W: loadOption.maxWidth }),
      });
    }
    if (config.depth > loadOption.maxDepth) {
      issues.push({
        field: 'loadCapacity',
        message: t(ER['ER-046'], locale, { N: config.loadCapacity, D: loadOption.maxDepth }),
      });
    }
  }

  const color = findColor(catalog, config.colorId);
  if (!color) {
    issues.push({ field: 'colorId', message: t(ER['ER-047'], locale) });
  }

  const assembly = findAssembly(catalog, config.assemblyId);
  if (!assembly) {
    issues.push({ field: 'assemblyId', message: t(ER['ER-048'], locale) });
  }

  const delivery = findDelivery(catalog, config.deliveryId);
  if (!delivery) {
    issues.push({ field: 'deliveryId', message: t(ER['ER-049'], locale) });
  }

  for (const selection of config.accessories) {
    const accessory = findAccessory(catalog, selection.accessoryId);
    if (!accessory) {
      issues.push({ field: 'accessories', message: t(ER['ER-050'], locale) });
      continue;
    }
    if (accessory.models.length > 0 && !accessory.models.includes(model.slug)) {
      issues.push({
        field: 'accessories',
        message: t(ER['ER-051'], locale, { accessory: pick(accessory.name, locale), model: modelName }),
      });
    }
    if (
      accessory.maxQuantityPerSection &&
      selection.quantity > accessory.maxQuantityPerSection * config.sections.length
    ) {
      issues.push({
        field: 'accessories',
        message: t(ER['ER-052'], locale, { accessory: pick(accessory.name, locale), N: accessory.maxQuantityPerSection }),
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
          message: t(ER['ER-053'], locale),
        });
      }
    }
  }

  return issues;
}
