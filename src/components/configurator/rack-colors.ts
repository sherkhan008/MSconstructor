import type { ColorOption } from '@/lib/types/domain';
import { DEFAULT_CONFIGURATION } from '@/store/configurator-store';
import { clamp } from './resize/dimension-scale';

/**
 * Reference tone for the standard/default rack, tuned to match real
 * powder-coated light-grey shelving reference photos — light, opaque,
 * matte-painted steel, not the transparent/mismatched-post look the
 * previous rendering had. ColorOption.hex ("color-grey", etc.) is
 * commercial catalog data and stays untouched by this visual-only change;
 * this constant is a rendering-only reference used only for the default
 * selection below, so every other selectable color still renders from its
 * own real hex — the configurable color system is unaffected.
 */
export const STANDARD_RACK_HEX = '#C9CED0';

/**
 * The single color every rack surface (uprights, shelves, panels) derives
 * from, in both preview components — resolved once, here, so the front
 * view and top view can never disagree, and so front/rear/left/right
 * uprights always read from one literal value rather than the old
 * unrelated STEEL_FRONT/STEEL_REAR constants.
 */
export function resolveRackFill(color: ColorOption | undefined): string {
  const isStandard = !color || color.id === DEFAULT_CONFIGURATION.colorId;
  return isStandard ? STANDARD_RACK_HEX : color.hex;
}

/**
 * Lightens (positive percent) or darkens (negative percent) a hex color by
 * blending each channel toward white/black. Used only for restrained
 * highlight/edge-shade variants of the single resolved rack color above —
 * never to create a second, materially different color for a "far" part
 * like a rear upright.
 */
export function shade(hex: string, percent: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const num = Number.parseInt(normalized, 16);
  const r = clamp(((num >> 16) & 0xff) + Math.round((percent / 100) * 255), 0, 255);
  const g = clamp(((num >> 8) & 0xff) + Math.round((percent / 100) * 255), 0, 255);
  const b = clamp((num & 0xff) + Math.round((percent / 100) * 255), 0, 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
