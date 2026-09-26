'use client';

import { useEffect, useState } from 'react';
import { useConfiguratorStore } from '@/store/configurator-store';
import { InstallDeliveryPanel } from './InstallDeliveryPanel';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import type { ConfigurationAccessorySelection } from '@/lib/types/domain';
import { METAL_FOOT_PAD_OPTION, SHELF_CORNER_BRACKETS_OPTION } from '@/lib/configurator/additional-options';
import { t } from '@/lib/i18n/format';
import { CF } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';
import { getTotalSectionShelves } from '@/lib/configurator/section-dimensions';

/**
 * Accessory ids the *customer* configurator may select — a small curated
 * subset of the full admin accessory catalog, backing three of the five
 * rack options (two below, the cross brace in the active section's own
 * controls — see ParametersSectionsTable). Exported so ConfiguratorClient's
 * normalization effect can strip anything else a stale persisted config or
 * share link carries, without wiping this list too (see that effect's
 * comment).
 */
export const CUSTOMER_ACCESSORY_IDS = ['acc-adjustable-feet', 'acc-shelf-reinforcement', 'acc-cross-brace'] as const;

/** The cross brace is a per-section accessory (its selection carries the
 * section's id), offered only for a 1000 mm section. */
export const CROSS_BRACE_ID = 'acc-cross-brace';
export const CROSS_BRACE_WIDTH_MM = 1000;

/** True for a cross-brace selection whose target section no longer exists
 * or is no longer 1000mm wide — reused by both the cleanup effect below and
 * ConfiguratorClient's own normalization pass. */
export function isStaleCrossBrace(selection: ConfigurationAccessorySelection, sections: { id: string; width: number }[]): boolean {
  if (selection.accessoryId !== CROSS_BRACE_ID) return false;
  const section = sections.find((s) => s.id === selection.sectionId);
  return !section || section.width !== CROSS_BRACE_WIDTH_MM;
}

/**
 * Single compact, collapsed-by-default disclosure for the customer's
 * secondary, KIT-WIDE choices: four rack options plus assembly/delivery.
 * Section-level choices (walls, the cross brace) live with the section they
 * belong to (see ParametersSectionsTable), so the two are never blurred.
 * Shelf type is no longer a customer choice at all — MS Standard now only
 * offers STANDARD (see seed-data.ts), so there is nothing left to pick.
 *
 * Two of the four options reuse the existing accessory mechanism
 * (config.accessories) with real catalog pricing. Two — "Металлический
 * подпятник" and "Уголки жесткости на полки" — have no matching commercial
 * component in the current catalog (see the task report), so they are
 * plain configuration flags: real, persisted, shared/cart/order-safe
 * customer intent that does not yet affect price.
 */
export function AdvancedSettingsAccordion({ catalog }: { catalog: PublicCatalog }) {
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const config = useConfiguratorStore((s) => s.config);
  const setField = useConfiguratorStore((s) => s.setField);
  const setMany = useConfiguratorStore((s) => s.setMany);
  const setAccessoryQuantity = useConfiguratorStore((s) => s.setAccessoryQuantity);
  const model = catalog.models.find((m) => m.slug === config.modelSlug);

  const adjustableFeetSelected = config.accessories.some((a) => a.accessoryId === 'acc-adjustable-feet');
  const shelfReinforcementSelected = config.accessories.some((a) => a.accessoryId === 'acc-shelf-reinforcement');

  // A cross brace attached to a section that got resized away from 1000mm
  // (or removed) would otherwise sit there silently until the next price
  // calculation surfaces it as a compatibility error — clean it up
  // proactively instead, the same way ConfiguratorClient's own normalization
  // effect fixes up other now-invalid selections. (This panel is always
  // mounted, so the cleanup runs even though the checkbox itself now sits in
  // the active section's controls.)
  useEffect(() => {
    const stale = config.accessories.filter((a) => isStaleCrossBrace(a, config.sections));
    if (stale.length === 0) return;
    setMany({ accessories: config.accessories.filter((a) => !stale.includes(a)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config.sections)]);

  function toggleAdjustableFeet(checked: boolean) {
    setAccessoryQuantity('acc-adjustable-feet', checked ? 1 : 0);
    // Both represent a foot upgrade at the same physical spot on the rack —
    // treated as mutually exclusive as a safe default. The catalog has no
    // explicit rule confirming this; see the task report.
    if (checked && config.metalFootPad) setField('metalFootPad', false);
  }

  function toggleMetalFootPad(checked: boolean) {
    setField('metalFootPad', checked);
    if (checked && adjustableFeetSelected) setAccessoryQuantity('acc-adjustable-feet', 0);
  }

  function toggleShelfReinforcement(checked: boolean) {
    // "В каждую полку" — one reinforcement rib per shelf across the whole
    // row, matching this accessory's own maxQuantityPerSection (8, i.e. the
    // model's own maxShelves) rather than a number invented here. Each
    // section counts its own shelves.
    const quantity = getTotalSectionShelves(config.sections);
    setAccessoryQuantity('acc-shelf-reinforcement', checked ? quantity : 0);
  }

  return (
    <div className="border border-line bg-surface text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-[15px] font-semibold transition-colors hover:bg-background/60"
      >
        <span>{t(CF['CF-042'], locale)}</span>
        <Chevron open={open} />
      </button>

      {open && model && (
        <div className="flex flex-col gap-4 border-t border-line p-4">
          <div className="flex flex-col gap-1">
            <OptionCheckbox
              label={t(CF['CF-043'], locale)}
              note={t(CF['CF-044'], locale)}
              checked={adjustableFeetSelected}
              onChange={toggleAdjustableFeet}
            />
            <OptionCheckbox label={t(METAL_FOOT_PAD_OPTION, locale)} checked={!!config.metalFootPad} onChange={toggleMetalFootPad} />
            <OptionCheckbox
              label={t(SHELF_CORNER_BRACKETS_OPTION, locale)}
              checked={!!config.shelfCornerBrackets}
              onChange={(checked) => setField('shelfCornerBrackets', checked)}
            />
            <OptionCheckbox
              label={t(CF['CF-047'], locale)}
              checked={shelfReinforcementSelected}
              onChange={toggleShelfReinforcement}
            />
          </div>

          <InstallDeliveryPanel catalog={catalog} />
        </div>
      )}
    </div>
  );
}

/** A labelled option checkbox with an optional note — shared with the
 * section controls' own option (the cross brace). */
export function OptionCheckbox({
  label,
  note,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex min-h-11 items-center gap-2.5 py-1 leading-snug ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={note ? `${label}. ${note}` : label}
        className="h-4 w-4 shrink-0 accent-[color:var(--color-foreground)]"
      />
      <span className="flex flex-col">
        <span>{label}</span>
        {note && <span className="text-[13px] text-steel">{note}</span>}
      </span>
    </label>
  );
}

/** Disclosure chevron shared by the configurator's collapsible panels. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={`shrink-0 text-steel transition-transform ${open ? 'rotate-180' : ''}`}>
      <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}
