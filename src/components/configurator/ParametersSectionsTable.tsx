'use client';

import { MAX_SECTIONS, MIN_SECTIONS, useConfiguratorStore } from '@/store/configurator-store';
import { NumberStepper } from './NumberStepper';
import { CROSS_BRACE_ID, CROSS_BRACE_WIDTH_MM, OptionCheckbox } from './AdvancedSettingsAccordion';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import { getAllowedKitDepths, getAllowedSectionWidths, getSectionLimits } from '@/lib/configurator/section-limits';
import { shelvesLabel } from '@/lib/plural';
import { t } from '@/lib/i18n/format';
import { dimensionOptionLabel, loadCapacityOptionLabel } from '@/lib/i18n/catalog-labels';
import { CF, CR, G } from '@/lib/i18n/strings';
import type { Locale } from '@/lib/i18n/locales';
import { useLocale } from '@/components/i18n/LocaleProvider';

type ProductModel = PublicCatalog['models'][number];

/**
 * The configurator's configuration panel (V2.4), in page order:
 *
 *  1. the current kit ("Комплект 1" — V2.4 always has exactly one; the kit
 *     switcher arrives with V2.5) and its KIT-WIDE parameters: the shared
 *     depth and load;
 *  2. its SECTIONS: every section is listed; the active one is expanded with
 *     its own width, height, shelf count, walls and section options, the
 *     others collapse to a one-line summary of their own values that selects
 *     them. Each control edits its own section only (`updateSection`), with a
 *     range read from that section's own values (see section-limits.ts) —
 *     there is no height or shelf control shared by every section.
 *
 * Reuses the existing store state/actions only; no new configuration state
 * is introduced. Every control exists exactly once in the DOM (only the
 * active section's fields are rendered), so plain CSS-attribute locators
 * (e.g. `select[aria-label="Ширина секции 1"]`) never see duplicates.
 */
export function ParametersSectionsTable({ catalog, onReset }: { catalog: PublicCatalog; onReset?: () => void }) {
  const config = useConfiguratorStore((s) => s.config);
  const activeSectionId = useConfiguratorStore((s) => s.activeSectionId);
  const setActiveSectionId = useConfiguratorStore((s) => s.setActiveSectionId);
  const addSection = useConfiguratorStore((s) => s.addSection);
  const removeSection = useConfiguratorStore((s) => s.removeSection);
  const duplicateSection = useConfiguratorStore((s) => s.duplicateSection);
  const updateSection = useConfiguratorStore((s) => s.updateSection);
  const setField = useConfiguratorStore((s) => s.setField);
  const setMany = useConfiguratorStore((s) => s.setMany);
  const locale = useLocale();

  const model = catalog.models.find((m) => m.slug === config.modelSlug);
  if (!model) return null;

  const canAdd = config.sections.length < MAX_SECTIONS;
  const canRemove = config.sections.length > MIN_SECTIONS;
  // Same resolution as the preview: an unknown active id falls back to the
  // first section, so exactly one section is always expanded.
  const activeSection = config.sections.find((s) => s.id === activeSectionId) ?? config.sections[0];

  function toggleCrossBrace(section: ShelvingSection, checked: boolean) {
    const others = config.accessories.filter((a) => !(a.accessoryId === CROSS_BRACE_ID && a.sectionId === section.id));
    setMany({ accessories: checked ? [...others, { accessoryId: CROSS_BRACE_ID, quantity: 1, sectionId: section.id }] : others });
  }

  return (
    <div className="border border-line bg-surface text-sm">
      <div className="p-4">
        <h2 className="font-display text-lg leading-tight">{t(CF['CF-104'], locale, { N: 1 })}</h2>
        <KitParamsFields config={config} model={model} catalog={catalog} setField={setField} />
      </div>

      <section aria-labelledby="configurator-sections-heading" className="border-t border-line">
        <h3 id="configurator-sections-heading" className="px-4 pb-2 pt-3.5 font-display text-base leading-tight">
          {t(CF['CF-105'], locale)}
        </h3>
        <ul className="border-t border-line">
          {config.sections.map((section, i) =>
            section.id === activeSection.id ? (
              <li
                key={section.id}
                data-section-row={i + 1}
                // Graphite rail + white surface for the active section, matching
                // the graphite outline the preview draws around that same
                // section — the two views of one selection must agree.
                className="border-b border-l-[3px] border-b-line border-l-foreground bg-surface px-4 pb-4 pt-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    aria-pressed
                    onClick={() => setActiveSectionId(section.id)}
                    className="-ml-1 min-h-11 px-1 text-left text-[15px] font-semibold text-foreground"
                  >
                    {t(CF['CF-025'], locale, { N: i + 1 })}
                  </button>
                  <div className="-mr-2 flex shrink-0 items-center">
                    <button
                      type="button"
                      disabled={!canAdd}
                      onClick={() => duplicateSection(section.id)}
                      className="min-h-11 px-2 text-[13px] font-medium text-steel transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {t(CR['CR-012'], locale)}
                    </button>
                    <button
                      type="button"
                      disabled={!canRemove}
                      onClick={() => removeSection(section.id)}
                      aria-label={t(CF['CF-026'], locale)}
                      title={t(CF['CF-026'], locale)}
                      className="grid h-11 w-11 place-items-center text-lg leading-none text-steel transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <SectionFields
                  section={section}
                  index={i}
                  model={model}
                  catalog={catalog}
                  widths={getAllowedSectionWidths(model, config.depth)}
                  crossBraceSelected={config.accessories.some((a) => a.accessoryId === CROSS_BRACE_ID && a.sectionId === section.id)}
                  onChange={(patch) => updateSection(section.id, patch)}
                  onToggleCrossBrace={(checked) => toggleCrossBrace(section, checked)}
                />
              </li>
            ) : (
              <li key={section.id} data-section-row={i + 1} className="border-b border-l-[3px] border-b-line border-l-transparent bg-background/60">
                <button
                  type="button"
                  aria-pressed={false}
                  aria-label={t(CF['CF-025'], locale, { N: i + 1 })}
                  aria-describedby={`section-summary-${section.id}`}
                  onClick={() => setActiveSectionId(section.id)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left transition-colors hover:bg-surface"
                >
                  <span className="shrink-0 text-[15px] font-semibold text-steel">{t(CF['CF-025'], locale, { N: i + 1 })}</span>
                  <span id={`section-summary-${section.id}`} data-testid="section-summary" className="mono min-w-0 truncate text-right text-[13px] text-steel">
                    {sectionSummary(section, locale)}
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>

        <div className="p-4">
          <button
            type="button"
            disabled={!canAdd}
            onClick={addSection}
            aria-label={t(CF['CF-027'], locale)}
            title={t(CF['CF-027'], locale)}
            className="flex min-h-11 w-full items-center justify-center border border-dashed border-line-strong text-[15px] font-medium text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-10"
          >
            {t(CF['CF-028'], locale)}
          </button>
          {/* Over the limit only happens for a row saved/shared before it
              dropped: kept intact, and the customer removes sections here. */}
          {config.sections.length > MAX_SECTIONS ? (
            <p role="alert" className="mt-2 text-[13px] text-danger">
              {t(CF['CF-103'], locale, { N: MAX_SECTIONS })}
            </p>
          ) : (
            !canAdd && <p className="mt-2 text-[13px] text-steel">{t(CF['CF-029'], locale)}</p>
          )}
          {/* Reset sits with the settings it resets: easy to find at the end
              of the panel, visually secondary to adding a section. Reuses the
              store's reset(), passed in by the page. */}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="mx-auto mt-2 flex min-h-11 items-center justify-center gap-2 px-2 text-center text-[13px] leading-tight text-steel transition-colors hover:text-foreground lg:min-h-10"
            >
              <ResetIcon />
              {t(CF['CF-022'], locale)}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** "1200 × 2500 мм · 8 полок" — one section's own values, for its collapsed row. */
function sectionSummary(section: ShelvingSection, locale: Locale): string {
  return `${section.width} × ${section.height} ${t(G['G-008'], locale)} · ${shelvesLabel(section.shelves, locale)}`;
}

/** Shared field chrome: readable sentence-case label over a 44px control. */
const FIELD_LABEL = 'text-[13px] leading-tight text-steel';
const SELECT_CLASS =
  'mono h-11 w-full min-w-0 border border-line bg-surface px-2.5 text-sm text-foreground outline-none transition-colors hover:border-line-strong focus:border-blueprint lg:h-10';

/** Kit-wide parameters: the depth every section shares and the shelf load. */
function KitParamsFields({
  config,
  model,
  catalog,
  setField,
}: {
  config: ShelvingConfiguration;
  model: ProductModel;
  catalog: PublicCatalog;
  setField: <K extends keyof ShelvingConfiguration>(key: K, value: ShelvingConfiguration[K]) => void;
}) {
  // MS Standard's depth select only offers depths valid for EVERY current
  // section's width (see ms-standard-compatibility.ts).
  const allowedDepths = getAllowedKitDepths(model, config.sections);
  const locale = useLocale();

  return (
    <div role="group" aria-label={t(CF['CF-024'], locale)} className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className={FIELD_LABEL}>{t(CF['CF-031'], locale)}</span>
        <select value={config.depth} onChange={(e) => setField('depth', Number(e.target.value))} className={SELECT_CLASS}>
          {catalog.depths
            .filter((d) => allowedDepths.includes(d.value))
            .map((d) => (
              <option key={d.id} value={d.value}>
                {dimensionOptionLabel(d, locale)}
              </option>
            ))}
        </select>
      </label>

      {/* Load options are words, not a bare number: sans face, and a full
          row below 400px so "Сөреге 150 кг" never clips inside the select. */}
      <label className="col-span-2 flex min-w-0 flex-col gap-1.5 min-[400px]:col-span-1">
        <span className={FIELD_LABEL}>{t(CF['CF-033'], locale)}</span>
        <select value={config.loadCapacity} onChange={(e) => setField('loadCapacity', Number(e.target.value))} className={`${SELECT_CLASS} !font-sans`}>
          {catalog.loadCapacities.map((load) => {
            const modelCompatible = model.loadCapacities.includes(load.value);
            const dimensionCompatible = config.sections.every((s) => s.width <= load.maxWidth) && config.depth <= load.maxDepth;
            const disabled = !modelCompatible || !dimensionCompatible;
            return (
              <option key={load.id} value={load.value} disabled={disabled}>
                {loadCapacityOptionLabel(load, locale)}
                {disabled ? ` ${t(CF['CF-034'], locale)}` : ''}
              </option>
            );
          })}
        </select>
      </label>
    </div>
  );
}

/**
 * One section's own controls. Width is compatibility-driven by the kit's
 * shared depth; height offers only the heights whose shelf ceiling fits THIS
 * section's shelf count; the shelf stepper stops at THIS section's own
 * height ceiling. Nothing here reads another section.
 */
function SectionFields({
  section,
  index,
  model,
  catalog,
  widths,
  crossBraceSelected,
  onChange,
  onToggleCrossBrace,
}: {
  section: ShelvingSection;
  index: number;
  model: ProductModel;
  catalog: PublicCatalog;
  widths: number[];
  crossBraceSelected: boolean;
  onChange: (patch: Partial<Omit<ShelvingSection, 'id'>>) => void;
  onToggleCrossBrace: (checked: boolean) => void;
}) {
  const locale = useLocale();
  const limits = getSectionLimits(model, section);
  const mm = t(G['G-008'], locale);
  const heights = catalog.heights.filter((h) => limits.heights.includes(h.value)).map((h) => h.value);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 min-[400px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={FIELD_LABEL}>
            {t(CF['CF-035'], locale)}, {mm}
          </span>
          <select
            value={section.width}
            data-section-index={index}
            aria-label={t(CF['CF-036'], locale, { N: index + 1 })}
            onChange={(e) => onChange({ width: Number(e.target.value) })}
            className={SELECT_CLASS}
          >
            {widths.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={FIELD_LABEL}>
            {t(CF['CF-030'], locale)}, {mm}
          </span>
          <select
            value={section.height}
            data-section-index={index}
            aria-label={t(CF['CF-106'], locale, { N: index + 1 })}
            onChange={(e) => onChange({ height: Number(e.target.value) })}
            className={SELECT_CLASS}
          >
            {heights.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>

        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 min-[400px]:col-span-1">
          <span className={FIELD_LABEL}>{t(CF['CF-032'], locale)}</span>
          <NumberStepper
            value={section.shelves}
            min={limits.minShelves}
            max={limits.maxShelves}
            onChange={(shelves) => onChange({ shelves })}
            testId="shelf-count"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <WallCheckbox label={t(CF['CF-037'], locale)} checked={section.rearWall} onChange={(checked) => onChange({ rearWall: checked })} />
        <WallCheckbox label={t(CF['CF-038'], locale)} checked={section.leftWall} onChange={(checked) => onChange({ leftWall: checked })} />
        <WallCheckbox label={t(CF['CF-039'], locale)} checked={section.rightWall} onChange={(checked) => onChange({ rightWall: checked })} />
      </div>

      {/* A section option, not a kit-wide one: the cross brace belongs to
          this section and exists only for a 1000 mm section (the same
          accessory selection with this section's id as before). */}
      <OptionCheckbox
        label={t(CF['CF-048'], locale)}
        note={t(CF['CF-049'], locale)}
        checked={crossBraceSelected}
        disabled={section.width !== CROSS_BRACE_WIDTH_MM}
        onChange={onToggleCrossBrace}
      />
    </div>
  );
}

/** A native checkbox inside a chip-shaped label: the whole chip is the
 * touch target, and the checked state reads from the tick and the darker
 * border together — never from colour alone. */
function WallCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label
      className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-2 border px-2 text-[13px] leading-tight transition-colors lg:min-h-10 ${
        checked ? 'border-foreground bg-surface text-foreground' : 'border-line bg-surface text-steel hover:border-line-strong'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-[color:var(--color-foreground)]"
      />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  );
}

function ResetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M3 8a5 5 0 1 0 1.5-3.55" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
      <path d="M3 2.5V5h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
    </svg>
  );
}
