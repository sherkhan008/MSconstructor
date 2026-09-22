import { CF } from '@/lib/i18n/strings';

/**
 * Customer-facing labels for the two "Дополнительные параметры" rack options
 * that have no priced catalog/accessory backing yet — see
 * ShelvingConfiguration's own doc comment in src/lib/types/domain.ts for why.
 * The three other options are real accessories, so their names come from the
 * catalog itself (the actual source of truth); these two have no catalog
 * entry to read from, so this is the single place both the configurator UI
 * (AdvancedSettingsAccordion) and the WhatsApp message builder read from,
 * rather than each hardcoding its own copy of the same string. Both are
 * owner-reviewed CSV entries (ru + kk): public UI renders the *_OPTION entry
 * in the page locale; the Russian *_LABEL strings serve the Russian-only
 * admin panel and order documents.
 */
export const METAL_FOOT_PAD_OPTION = CF['CF-045'];
export const SHELF_CORNER_BRACKETS_OPTION = CF['CF-046'];

export const METAL_FOOT_PAD_LABEL: string = METAL_FOOT_PAD_OPTION.ru;
export const SHELF_CORNER_BRACKETS_LABEL: string = SHELF_CORNER_BRACKETS_OPTION.ru;
