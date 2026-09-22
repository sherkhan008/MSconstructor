'use client';

import { MAX_SECTIONS, MIN_SECTIONS, useConfiguratorStore } from '@/store/configurator-store';
import { NumberStepper } from './NumberStepper';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import type { ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import {
  getAllowedDepthsForSections,
  getAllowedHeightsForShelfCount,
  getAllowedWidthsForDepth,
  getMaxShelvesForHeight,
  MS_STANDARD_MIN_SHELVES,
} from '@/lib/pricing/ms-standard-compatibility';
import { t } from '@/lib/i18n/format';
import { dimensionOptionLabel, loadCapacityOptionLabel } from '@/lib/i18n/catalog-labels';
import { CF } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

type ProductModel = PublicCatalog['models'][number];
type WallField = 'rearWall' | 'leftWall' | 'rightWall';

/**
 * The configurator's configuration panel: row parameters (height, depth,
 * shelves, load) followed by one row per section (width, walls) and the add
 * button. Reuses the exact same store state/actions the old
 * GeneralSettingsPanel + SectionTable pair used; no new configuration state
 * is introduced. Every control exists exactly once in the DOM, so plain
 * CSS-attribute locators used by existing e2e tests (e.g.
 * `select[aria-label="Ширина секции 1"]`) never see duplicates.
 */
export function ParametersSectionsTable({ catalog, onReset }: { catalog: PublicCatalog; onReset?: () => void }) {
  const config = useConfiguratorStore((s) => s.config);
  const activeSectionId = useConfiguratorStore((s) => s.activeSectionId);
  const setActiveSectionId = useConfiguratorStore((s) => s.setActiveSectionId);
  const addSection = useConfiguratorStore((s) => s.addSection);
  const removeSection = useConfiguratorStore((s) => s.removeSection);
  const updateSection = useConfiguratorStore((s) => s.updateSection);
  const setField = useConfiguratorStore((s) => s.setField);
  const locale = useLocale();

  const model = catalog.models.find((m) => m.slug === config.modelSlug);
  if (!model) return null;

  // MS Standard's width select must respect the CURRENT global depth (depth
  // is per-row, width is per-section — see ms-standard-compatibility.ts):
  // e.g. depth=700 only leaves width 1000 selectable. Every other model
  // keeps using its own flat width list — it has no such cross-dimensional
  // rule today.
  const widths =
    model.slug === 'ms-standard' ? getAllowedWidthsForDepth(config.depth) : (model.widths ?? catalog.widths.map((w) => w.value));
  const canAdd = config.sections.length < MAX_SECTIONS;
  const canRemove = config.sections.length > MIN_SECTIONS;

  function handleFocusSection(id: string) {
    setActiveSectionId(id);
  }
  function handleChangeWidth(id: string, width: number) {
    setActiveSectionId(id);
    updateSection(id, { width });
  }
  function handleToggleWall(id: string, field: WallField, checked: boolean) {
    setActiveSectionId(id);
    updateSection(id, { [field]: checked });
  }

  return (
    <div className="border border-line bg-surface text-sm">
      <div className="p-4">
        <h2 className="font-display text-lg leading-tight">{t(CF['CF-024'], locale)}</h2>
        <RowParamsFields config={config} model={model} catalog={catalog} setField={setField} />
      </div>

      <ul className="border-t border-line">
        {config.sections.map((section, i) => {
          const active = section.id === activeSectionId;
          return (
            <li
              key={section.id}
              className={`border-b border-l-[3px] border-b-line px-4 pb-3 pt-1 ${active ? 'border-l-dimension-accent bg-surface' : 'border-l-transparent bg-background/60'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSectionId(section.id)}
                  aria-pressed={active}
                  className={`-ml-1 min-h-11 px-1 text-left text-[15px] font-semibold ${active ? 'text-dimension-accent' : 'text-foreground hover:text-steel'}`}
                >
                  {t(CF['CF-025'], locale, { N: i + 1 })}
                </button>
                <button
                  type="button"
                  disabled={!canRemove}
                  onClick={() => removeSection(section.id)}
                  aria-label={t(CF['CF-026'], locale)}
                  title={t(CF['CF-026'], locale)}
                  className="-mr-2 grid h-11 w-11 shrink-0 place-items-center text-lg leading-none text-steel transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ×
                </button>
              </div>
              <SectionFields
                section={section}
                index={i}
                widths={widths}
                onFocus={() => handleFocusSection(section.id)}
                onChangeWidth={(w) => handleChangeWidth(section.id, w)}
                onToggleWall={(field, checked) => handleToggleWall(section.id, field, checked)}
              />
            </li>
          );
        })}
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
        {!canAdd && <p className="mt-2 text-[13px] text-steel">{t(CF['CF-029'], locale)}</p>}
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
    </div>
  );
}

/** Shared field chrome: readable sentence-case label over a 44px control. */
const FIELD_LABEL = 'text-[13px] leading-tight text-steel';
const SELECT_CLASS =
  'mono h-11 w-full min-w-0 border border-line bg-surface px-2.5 text-sm text-foreground outline-none transition-colors hover:border-line-strong focus:border-blueprint lg:h-10';

function RowParamsFields({
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
  // MS Standard's height/depth/shelf controls are cross-dimensional (see
  // ms-standard-compatibility.ts): the height select only offers heights
  // whose own shelf ceiling can fit the CURRENT shelf count, the depth
  // select only offers depths valid for EVERY current section's width, and
  // the shelf stepper's own max follows the CURRENT height. Every other
  // model keeps its simple flat-list behaviour — it has none of these
  // cross-rules today.
  const isMsStandard = model.slug === 'ms-standard';
  const allowedHeights = isMsStandard ? getAllowedHeightsForShelfCount(config.shelves) : model.heights;
  const allowedDepths = isMsStandard ? getAllowedDepthsForSections(config.sections) : model.depths;
  const shelvesMax = isMsStandard ? (getMaxShelvesForHeight(config.height) ?? model.maxShelves) : model.maxShelves;
  const shelvesMin = isMsStandard ? MS_STANDARD_MIN_SHELVES : model.minShelves;
  const locale = useLocale();

  return (
    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className={FIELD_LABEL}>{t(CF['CF-030'], locale)}</span>
        <select value={config.height} onChange={(e) => setField('height', Number(e.target.value))} className={SELECT_CLASS}>
          {catalog.heights
            .filter((h) => allowedHeights.includes(h.value))
            .map((h) => (
              <option key={h.id} value={h.value}>
                {dimensionOptionLabel(h, locale)}
              </option>
            ))}
        </select>
      </label>

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

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={FIELD_LABEL}>{t(CF['CF-032'], locale)}</span>
        <NumberStepper value={config.shelves} min={shelvesMin} max={shelvesMax} onChange={(v) => setField('shelves', v)} testId="shelf-count" />
      </div>

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

function SectionFields({
  section,
  index,
  widths,
  onFocus,
  onChangeWidth,
  onToggleWall,
}: {
  section: ShelvingSection;
  index: number;
  widths: number[];
  onFocus: () => void;
  onChangeWidth: (width: number) => void;
  onToggleWall: (field: WallField, checked: boolean) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-2.5">
      <label className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3">
        <span className={FIELD_LABEL}>{t(CF['CF-035'], locale)}</span>
        <select
          value={section.width}
          data-section-index={index}
          aria-label={t(CF['CF-036'], locale, { N: index + 1 })}
          onClick={onFocus}
          onChange={(e) => onChangeWidth(Number(e.target.value))}
          className={SELECT_CLASS}
        >
          {widths.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-3 gap-2">
        <WallCheckbox label={t(CF['CF-037'], locale)} checked={section.rearWall} onFocus={onFocus} onChange={(checked) => onToggleWall('rearWall', checked)} />
        <WallCheckbox label={t(CF['CF-038'], locale)} checked={section.leftWall} onFocus={onFocus} onChange={(checked) => onToggleWall('leftWall', checked)} />
        <WallCheckbox label={t(CF['CF-039'], locale)} checked={section.rightWall} onFocus={onFocus} onChange={(checked) => onToggleWall('rightWall', checked)} />
      </div>
    </div>
  );
}

/** A native checkbox inside a chip-shaped label: the whole chip is the
 * touch target, and the checked state reads from the tick and the darker
 * border together — never from colour alone. */
function WallCheckbox({
  label,
  checked,
  onFocus,
  onChange,
}: {
  label: string;
  checked: boolean;
  onFocus: () => void;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-2 border px-2 text-[13px] leading-tight transition-colors lg:min-h-10 ${
        checked ? 'border-foreground bg-surface text-foreground' : 'border-line bg-surface text-steel hover:border-line-strong'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onFocus={onFocus}
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
