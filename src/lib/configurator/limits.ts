/**
 * Section-count bounds for one shelving configuration — the single source
 * shared by the server-side schema (src/lib/pricing/schema.ts, the
 * authority), the configurator store/UI and the share-link parser.
 */
export const MIN_SECTIONS = 1;
export const MAX_SECTIONS = 5;

/**
 * The maximum before it dropped to MAX_SECTIONS. Used only as a parse
 * ceiling for data created under the old limit (persisted browser state,
 * shared links): such a configuration is kept exactly as it was and shown
 * as invalid until the customer removes sections — never silently
 * truncated. It is never a valid size; the server rejects anything above
 * MAX_SECTIONS.
 */
export const LEGACY_MAX_SECTIONS = 10;

/**
 * Kits in one configurator workspace (V2.5). A kit is one independent
 * ShelvingConfiguration; its own `quantity` is how many physical racks of it
 * are ordered, so this bound is separate from the order's physical-rack
 * limit (MAX_KITS_PER_ORDER in src/lib/orders/limits.ts, Σ quantity), which
 * the workspace must respect as well.
 */
export const MIN_WORKSPACE_KITS = 1;
export const MAX_WORKSPACE_KITS = 5;
