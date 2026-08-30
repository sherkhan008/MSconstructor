/**
 * Customer-facing labels for the two "Дополнительные параметры" rack options
 * that have no priced catalog/accessory backing yet — see
 * ShelvingConfiguration's own doc comment in src/lib/types/domain.ts for why.
 * The three other options are real accessories, so their names come from the
 * catalog itself (the actual source of truth); these two have no catalog
 * entry to read from, so this is the single place both the configurator UI
 * (AdvancedSettingsAccordion) and the WhatsApp message builder read from,
 * rather than each hardcoding its own copy of the same string.
 */
export const METAL_FOOT_PAD_LABEL = 'Металлический подпятник';
export const SHELF_CORNER_BRACKETS_LABEL = 'Уголки жесткости на полки';
