import type { ProductModel, ShelvingSection } from '@/lib/types/domain';
import {
  getAllowedDepthsForSections,
  getAllowedHeightsForShelfCount,
  getAllowedWidthsForDepth,
  getMaxShelvesForHeight,
  MS_STANDARD_MIN_SHELVES,
} from '@/lib/pricing/ms-standard-compatibility';

/**
 * The customer UI's allowed values, per section (Configurator V2.4). Every
 * control that edits one section — its height select, its shelf stepper, the
 * preview's height drag and shelf +/- — reads its range from here, from THAT
 * section's own values only. Nothing here reads another section's height or
 * shelf count: there is no shared height or shelf range any more.
 *
 * MS Standard ranges come from the authoritative matrix
 * (ms-standard-compatibility.ts); every other model keeps its flat catalog
 * lists, which have no cross-dimensional rules. These are UI ranges only —
 * the server still validates every configuration it prices.
 */

type ModelLimits = Pick<ProductModel, 'slug' | 'heights' | 'widths' | 'depths' | 'minShelves' | 'maxShelves'>;

export interface SectionLimits {
  /** Heights this section may take with its CURRENT shelf count. */
  heights: number[];
  minShelves: number;
  /** The shelf ceiling of this section's CURRENT height. */
  maxShelves: number;
}

function isMsStandard(model: ModelLimits): boolean {
  return model.slug === 'ms-standard';
}

/** One section's own height and shelf range. */
export function getSectionLimits(model: ModelLimits, section: Pick<ShelvingSection, 'height' | 'shelves'>): SectionLimits {
  if (!isMsStandard(model)) {
    return { heights: model.heights, minShelves: model.minShelves, maxShelves: model.maxShelves };
  }
  return {
    heights: getAllowedHeightsForShelfCount(section.shelves),
    minShelves: MS_STANDARD_MIN_SHELVES,
    // An unrecognised height has no known ceiling; the model's own maximum is
    // the safe bound until normalization repairs the height.
    maxShelves: getMaxShelvesForHeight(section.height) ?? model.maxShelves,
  };
}

/** Section widths valid for the kit's shared depth. */
export function getAllowedSectionWidths(model: ModelLimits, depth: number): number[] {
  return isMsStandard(model) ? getAllowedWidthsForDepth(depth) : model.widths;
}

/** Kit depths valid for every current section's width. */
export function getAllowedKitDepths(model: ModelLimits, sections: readonly Pick<ShelvingSection, 'width'>[]): number[] {
  return isMsStandard(model) ? getAllowedDepthsForSections(sections) : model.depths;
}
