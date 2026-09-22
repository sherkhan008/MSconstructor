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

/**
 * Accessory ids the *customer* configurator may select — a small curated
 * subset of the full admin accessory catalog, backing three of the five
 * rack options below. Exported so ConfiguratorClient's normalization effect
 * can strip anything else a stale persisted config or share link carries,
 * without wiping this list too (see that effect's comment).
 */
export const CUSTOMER_ACCESSORY_IDS = ['acc-adjustable-feet', 'acc-shelf-reinforcement', 'acc-cross-brace'] as const;

const CROSS_BRACE_ID = 'acc-cross-brace';
const CROSS_BRACE_WIDTH_MM = 1000;

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
 * secondary choices: five real rack options plus assembly/delivery. Shelf
 * type is no longer a customer choice at all — MS Standard now only offers
 * STANDARD (see seed-data.ts), so there is nothing left to pick.
 *
 * Three of the five options reuse the existing accessory mechanism
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
  const activeSectionId = useConfiguratorStore((s) => s.activeSectionId);
  const setField = useConfiguratorStore((s) => s.setField);
  const setMany = useConfiguratorStore((s) => s.setMany);
  const setAccessoryQuantity = useConfiguratorStore((s) => s.setAccessoryQuantity);
  const model = catalog.models.find((m) => m.slug === config.modelSlug);

  const activeSection = config.sections.find((s) => s.id === activeSectionId) ?? config.sections[0];
  const crossBraceEligible = activeSection?.width === CROSS_BRACE_WIDTH_MM;
  const crossBraceSelectedHere = config.accessories.some((a) => a.accessoryId === CROSS_BRACE_ID && a.sectionId === activeSection?.id);
  const adjustableFeetSelected = config.accessories.some((a) => a.accessoryId === 'acc-adjustable-feet');
  const shelfReinforcementSelected = config.accessories.some((a) => a.accessoryId === 'acc-shelf-reinforcement');

  // A cross brace attached to a section that got resized away from 1000mm
  // (or removed) would otherwise sit there silently until the next price
  // calculation surfaces it as a compatibility error — clean it up
  // proactively instead, the same way ConfiguratorClient's own normalization
  // effect fixes up other now-invalid selections.
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
    // model's own maxShelves) rather than a number invented here.
    const quantity = config.shelves * config.sections.length;
    setAccessoryQuantity('acc-shelf-reinforcement', checked ? quantity : 0);
  }

  function toggleCrossBrace(checked: boolean) {
    if (!activeSection) return;
    const withoutThisSection = config.accessories.filter(
      (a) => !(a.accessoryId === CROSS_BRACE_ID && a.sectionId === activeSection.id),
    );
    const next = checked
      ? [...withoutThisSection, { accessoryId: CROSS_BRACE_ID, quantity: 1, sectionId: activeSection.id }]
      : withoutThisSection;
    setMany({ accessories: next });
  }

  return (
    <div className="border border-line bg-surface text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="tech-label">{t(CF['CF-042'], locale)}</span>
        <span aria-hidden="true" className="text-steel">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && model && (
        <div className="flex flex-col gap-4 border-t border-line p-3">
          <div className="flex flex-col gap-2.5">
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
            <OptionCheckbox
              label={t(CF['CF-048'], locale)}
              note={t(CF['CF-049'], locale)}
              checked={crossBraceSelectedHere}
              disabled={!crossBraceEligible}
              onChange={toggleCrossBrace}
            />
          </div>

          <InstallDeliveryPanel catalog={catalog} />
        </div>
      )}
    </div>
  );
}

function OptionCheckbox({
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
    <label className={`flex items-start gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={note ? `${label}. ${note}` : label}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-dimension-accent)]"
      />
      <span className="flex flex-col">
        <span>{label}</span>
        {note && <span className="text-xs text-steel">{note}</span>}
      </span>
    </label>
  );
}
