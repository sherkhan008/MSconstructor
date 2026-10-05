'use client';

import {
  DEFAULT_CONFIGURATION,
  EMPTY_KIT_PRICE,
  isKitPriceCurrent,
  MAX_SECTIONS,
  MAX_WORKSPACE_KITS,
  MIN_SECTIONS,
  MIN_WORKSPACE_KITS,
  selectActiveKit,
  selectActiveSectionId,
  selectConfig,
  useConfiguratorStore,
} from '@/store/configurator-store';
import { NumberStepper } from './NumberStepper';
import { CROSS_BRACE_ID, CROSS_BRACE_WIDTH_MM, OptionCheckbox } from './AdvancedSettingsAccordion';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import type { SectionCorner, ShelvingConfiguration, ShelvingSection } from '@/lib/types/domain';
import { getAllowedKitDepths, getAllowedSectionWidths, getSectionLimits } from '@/lib/configurator/section-limits';
import { allowedCornersAt } from '@/lib/configurator/corners';
import { t, type Entry } from '@/lib/i18n/format';
import { dimensionOptionLabel, loadCapacityOptionLabel } from '@/lib/i18n/catalog-labels';
import { CF, CR, G, VL } from '@/lib/i18n/strings';
import { formatPrice } from '@/lib/money';
import { MAX_KITS_PER_ORDER } from '@/lib/orders/limits';
import { canAddWorkspaceRacks, getWorkspaceRackCount } from '@/lib/configurator/workspace';
import { useLocale } from '@/components/i18n/LocaleProvider';

type ProductModel = PublicCatalog['models'][number];

/**
 * The configurator's configuration panel (V2.4, workspace V2.5), in page order:
 *
 *  0. the KIT SWITCHER (V2.5): every kit of the workspace in order, the
 *     active one filled graphite, each with its own current server price,
 *     and "+ Комплект" (at most MAX_WORKSPACE_KITS kits and Σ quantity ≤ 5);
 *  1. the active kit ("Комплект N", with duplicate/remove) and its KIT-WIDE
 *     parameters: load and the kit's quantity;
 *  2. its DIMENSIONS (2026-10-01): the ONE depth the whole kit shares
 *     ("Глубина комплекта"), directly above its SECTIONS — one column per
 *     section, side by side where they fit and wrapping (five on a wide
 *     screen, stacked full-width on a phone), each its own vertical unit:
 *     its width, height, shelf count, orientation (edge sections only —
 *     straight, or a corner on its own edge, see corners.ts), walls and
 *     section option. Each control edits its own section only
 *     (`updateSection`), with a range read from that section's own values
 *     (see section-limits.ts) — there is no height or shelf control shared
 *     by every section. The selected section's column is outlined like its
 *     drawing and carries duplicate/remove.
 *
 * Reuses the existing store state/actions only; no new configuration state
 * is introduced (every control edits the active kit's configuration). Every
 * section's controls carry that section's number in their accessible name
 * or sit in its labelled column (`data-section-column`), so a locator such
 * as `select[aria-label="Ширина секции 1"]` names exactly one control.
 */
export function ParametersSectionsTable({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore(selectConfig);
  const activeSectionId = useConfiguratorStore(selectActiveSectionId);
  const kits = useConfiguratorStore((s) => s.kits);
  const activeKit = useConfiguratorStore(selectActiveKit);
  const duplicateKit = useConfiguratorStore((s) => s.duplicateKit);
  const removeKit = useConfiguratorStore((s) => s.removeKit);
  const setKitQuantity = useConfiguratorStore((s) => s.setKitQuantity);
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

  const activeKitIndex = Math.max(0, kits.findIndex((k) => k.id === activeKit.id));
  const canDuplicateKit = kits.length < MAX_WORKSPACE_KITS && canAddWorkspaceRacks(kits, config.quantity);
  const canRemoveKit = kits.length > MIN_WORKSPACE_KITS;
  // Quantity may only grow into the racks the workspace has left (Σ ≤ 5);
  // it can always shrink, even while the workspace is over the limit.
  const maxQuantity = config.quantity + Math.max(0, MAX_KITS_PER_ORDER - getWorkspaceRackCount(kits));

  function toggleCrossBrace(section: ShelvingSection, checked: boolean) {
    const others = config.accessories.filter((a) => !(a.accessoryId === CROSS_BRACE_ID && a.sectionId === section.id));
    setMany({ accessories: checked ? [...others, { accessoryId: CROSS_BRACE_ID, quantity: 1, sectionId: section.id }] : others });
  }

  return (
    <div className="rounded-lg border border-line bg-surface text-sm">
      <div className="p-4 lg:px-6">
        <KitSwitcher />
        {/* The active kit's own header mirrors a section row: its name, then
            duplicate and remove for THIS kit. */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2">
          <h2 className="font-display text-lg leading-tight">{t(CF['CF-104'], locale, { N: activeKitIndex + 1 })}</h2>
          <div className="-mr-2 flex shrink-0 items-center">
            <button
              type="button"
              disabled={!canDuplicateKit}
              onClick={() => duplicateKit(activeKit.id)}
              aria-label={t(CF['CF-112'], locale)}
              title={t(CF['CF-112'], locale)}
              className="min-h-11 px-2 text-[13px] font-medium text-steel transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t(CR['CR-012'], locale)}
            </button>
            <button
              type="button"
              disabled={!canRemoveKit}
              onClick={() => removeKit(activeKit.id)}
              aria-label={t(CF['CF-113'], locale)}
              title={t(CF['CF-113'], locale)}
              className="grid h-11 w-11 place-items-center text-lg leading-none text-steel transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
            >
              ×
            </button>
          </div>
        </div>
        <KitParamsFields
          config={config}
          model={model}
          catalog={catalog}
          setField={setField}
          maxQuantity={maxQuantity}
          onQuantityChange={(quantity) => setKitQuantity(activeKit.id, quantity)}
        />
      </div>

      {/* The kit's dimensions as one group (2026-10-01): the ONE depth every
          section shares, directly above the sections' own widths and
          heights — one column per section. */}
      <section aria-labelledby="configurator-sections-heading" className="border-t border-line">
        <h3 id="configurator-sections-heading" className="px-4 pb-2 pt-3.5 font-display text-base leading-tight lg:px-6">
          {t(CF['CF-105'], locale)}
        </h3>
        <KitDepthField config={config} model={model} catalog={catalog} setField={setField} />
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-3 px-4 lg:px-6">
          {config.sections.map((section, i) => {
            const active = section.id === activeSection.id;
            const titleId = `section-title-${section.id}`;
            return (
              <li
                key={section.id}
                data-section-column={i + 1}
                // A graphite outline on the active section's column, matching
                // the graphite outline the preview draws around that same
                // section — the two views of one selection must agree.
                className={`min-w-0 rounded-md border bg-surface px-3 pb-3 ${active ? 'border-foreground' : 'border-line'}`}
              >
                <div role="group" aria-labelledby={titleId}>
                  <button
                    type="button"
                    id={titleId}
                    aria-pressed={active}
                    onClick={() => setActiveSectionId(section.id)}
                    className={`-ml-1 min-h-11 px-1 text-left text-[15px] font-semibold transition-colors ${active ? 'text-foreground' : 'text-steel hover:text-foreground'}`}
                  >
                    {t(CF['CF-025'], locale, { N: i + 1 })}
                  </button>
                  <SectionFields
                    section={section}
                    index={i}
                    corners={allowedCornersAt(i, config.sections.length)}
                    model={model}
                    catalog={catalog}
                    widths={getAllowedSectionWidths(model, config.depth)}
                    crossBraceSelected={config.accessories.some((a) => a.accessoryId === CROSS_BRACE_ID && a.sectionId === section.id)}
                    onChange={(patch) => updateSection(section.id, patch)}
                    onToggleCrossBrace={(checked) => toggleCrossBrace(section, checked)}
                  />
                  {/* Duplicate and remove act on the selected section, as
                      before: one of each on the page, at the foot of its
                      column so every column's fields stay level. */}
                  {active && (
                    <div className="-mb-3 mt-2 flex items-center justify-between border-t border-line">
                      <button
                        type="button"
                        disabled={!canAdd}
                        onClick={() => duplicateSection(section.id)}
                        className="-ml-1 min-h-11 px-1 text-[13px] font-medium text-steel transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t(CR['CR-012'], locale)}
                      </button>
                      <button
                        type="button"
                        disabled={!canRemove}
                        onClick={() => removeSection(section.id)}
                        aria-label={t(CF['CF-026'], locale)}
                        title={t(CF['CF-026'], locale)}
                        className="-mr-2 grid h-11 w-11 place-items-center text-lg leading-none text-steel transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="p-4 lg:px-6">
          <button
            type="button"
            disabled={!canAdd}
            onClick={addSection}
            aria-label={t(CF['CF-027'], locale)}
            title={t(CF['CF-027'], locale)}
            className="flex min-h-11 w-full items-center justify-center rounded-md border border-dashed border-line-strong text-[15px] font-medium text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-10"
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
        </div>
      </section>
    </div>
  );
}

/** Customer label of each orientation (V2.6). */
const CORNER_LABELS: Record<SectionCorner, Entry> = { NONE: CF['CF-121'], LEFT: CF['CF-122'], RIGHT: CF['CF-123'] };

/** Shared field chrome. On phones one compact row per field — a readable
 * sentence-case label on the left, a 44px control aligned in a consistent
 * right column; below 400px the label sits above a full-width control
 * instead, so a select such as the load ("Сөреге 150 кг") is never clipped.
 * From `md` each field is a cell of its group's horizontal grid (kit
 * parameters, a section's dimensions) — the controls have the page's full
 * width there — with the label above its control, so three or four fields
 * share one row without squeezing either. */
const GRID_FIELD =
  'flex min-w-0 flex-col gap-1.5 min-[400px]:max-md:grid min-[400px]:max-md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] min-[400px]:max-md:items-center min-[400px]:max-md:gap-3';
const FIELD_LABEL = 'text-[13px] leading-tight text-foreground/80';
const SELECT_CLASS =
  'mono h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-foreground outline-none transition-colors hover:border-steel-soft focus:border-blueprint lg:h-10';

/**
 * The workspace's kits (V2.5): one button per kit, in order — the active one
 * filled graphite (the same pressed look as the preview-mode toggle), each
 * showing its own last server price (dimmed while it is being recalculated,
 * "—" when it could not be priced) — then "+ Комплект", which starts a new
 * kit from the default configuration (duplicating is the kit header's own
 * action). Wraps instead of scrolling, so five kits never widen the page.
 */
function KitSwitcher() {
  const kits = useConfiguratorStore((s) => s.kits);
  const activeKitId = useConfiguratorStore((s) => s.activeKitId);
  const kitPrices = useConfiguratorStore((s) => s.kitPrices);
  const selectKit = useConfiguratorStore((s) => s.selectKit);
  const addKit = useConfiguratorStore((s) => s.addKit);
  const locale = useLocale();

  const atKitLimit = kits.length >= MAX_WORKSPACE_KITS;
  const rackLimitBlocksAdd = !atKitLimit && !canAddWorkspaceRacks(kits, DEFAULT_CONFIGURATION.quantity);

  return (
    <div>
      <div role="group" aria-label={t(CF['CF-109'], locale)} className="flex flex-wrap gap-1.5">
        {kits.map((kit, i) => {
          const active = kit.id === activeKitId;
          const price = kitPrices[kit.id] ?? EMPTY_KIT_PRICE;
          const current = isKitPriceCurrent(price, kit.configuration);
          const label = price.result ? formatPrice(price.result.breakdown.total) : price.error && current ? '—' : '…';
          return (
            <button
              key={kit.id}
              type="button"
              aria-pressed={active}
              data-kit-tab={i + 1}
              onClick={() => selectKit(kit.id)}
              className={`flex min-h-11 min-w-0 flex-col items-start justify-center rounded-md border px-2.5 py-1 text-left leading-tight transition-colors ${
                active ? 'border-foreground bg-foreground text-surface' : 'border-line bg-surface text-steel hover:border-line-strong hover:text-foreground'
              }`}
            >
              <span className="text-[13px] font-semibold">{t(CF['CF-104'], locale, { N: i + 1 })}</span>
              <span className={`mono whitespace-nowrap text-[11px] ${current ? '' : 'opacity-60'}`}>{label}</span>
            </button>
          );
        })}
        {!atKitLimit && (
          <button
            type="button"
            disabled={rackLimitBlocksAdd}
            onClick={addKit}
            aria-label={t(CF['CF-111'], locale)}
            title={t(CF['CF-111'], locale)}
            className="flex min-h-11 items-center justify-center rounded-md border border-dashed border-line-strong px-3 text-[13px] font-medium text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t(CF['CF-110'], locale)}
          </button>
        )}
      </div>
      {atKitLimit && <p className="mt-2 text-[13px] text-steel">{t(CF['CF-118'], locale, { N: MAX_WORKSPACE_KITS })}</p>}
      {rackLimitBlocksAdd && <p className="mt-2 text-[13px] text-steel">{t(VL['VL-018'], locale, { N: MAX_KITS_PER_ORDER })}</p>}
    </div>
  );
}

type SetField = <K extends keyof ShelvingConfiguration>(key: K, value: ShelvingConfiguration[K]) => void;

/**
 * The depth every section of the kit shares — ONE value per kit, never per
 * section — shown at the head of the sections' dimensions so width, height
 * and depth read as one group, and named as the kit's own ("Глубина
 * комплекта · Одна для всех секций") so it is never mistaken for a section
 * value.
 */
function KitDepthField({ config, model, catalog, setField }: { config: ShelvingConfiguration; model: ProductModel; catalog: PublicCatalog; setField: SetField }) {
  // MS Standard's depth select only offers depths valid for EVERY current
  // section's width (see ms-standard-compatibility.ts).
  const allowedDepths = getAllowedKitDepths(model, config.sections);
  const locale = useLocale();
  return (
    <div data-testid="kit-depth" className="flex flex-col gap-1.5 px-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 lg:px-6">
      <label className="flex min-w-0 flex-col gap-1.5 min-[400px]:flex-row min-[400px]:items-center min-[400px]:gap-3">
        <span className={`${FIELD_LABEL} min-[400px]:shrink-0`}>{t(CF['CF-129'], locale)}</span>
        <select value={config.depth} onChange={(e) => setField('depth', Number(e.target.value))} className={`${SELECT_CLASS} min-[400px]:w-40`}>
          {catalog.depths
            .filter((d) => allowedDepths.includes(d.value))
            .map((d) => (
              <option key={d.id} value={d.value}>
                {dimensionOptionLabel(d, locale)}
              </option>
            ))}
        </select>
      </label>
      <p className="text-[13px] leading-tight text-steel">{t(CF['CF-130'], locale)}</p>
    </div>
  );
}

/** Kit-wide parameters other than its dimensions: the shelf load and how
 * many racks of this kit are ordered. */
function KitParamsFields({
  config,
  model,
  catalog,
  setField,
  maxQuantity,
  onQuantityChange,
}: {
  config: ShelvingConfiguration;
  model: ProductModel;
  catalog: PublicCatalog;
  setField: SetField;
  maxQuantity: number;
  onQuantityChange: (quantity: number) => void;
}) {
  const locale = useLocale();

  return (
    <div role="group" aria-label={t(CF['CF-024'], locale)} className="mt-2 flex flex-col gap-2.5 md:grid md:grid-cols-3 md:gap-x-6 md:gap-y-3">
      {/* Load options are words, not a bare number: sans face. */}
      <label className={GRID_FIELD}>
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

      <div className={GRID_FIELD}>
        <span className={FIELD_LABEL}>{t(CF['CF-114'], locale)}</span>
        <NumberStepper
          value={config.quantity}
          min={1}
          max={Math.max(1, maxQuantity)}
          onChange={onQuantityChange}
          testId="kit-quantity"
          decreaseLabel={t(CF['CF-115'], locale)}
          increaseLabel={t(CF['CF-116'], locale)}
        />
      </div>
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
  corners,
  model,
  catalog,
  widths,
  crossBraceSelected,
  onChange,
  onToggleCrossBrace,
}: {
  section: ShelvingSection;
  index: number;
  /** The orientations this section's position allows (corners.ts). */
  corners: SectionCorner[];
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

  // One vertical unit per section (its own column): width, height, shelves —
  // and the orientation, on an edge section that offers one — then its walls
  // and its own option.
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        <label className={GRID_FIELD}>
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

        <label className={GRID_FIELD}>
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

        <div className={GRID_FIELD}>
          <span className={FIELD_LABEL}>{t(CF['CF-032'], locale)}</span>
          <NumberStepper
            value={section.shelves}
            min={limits.minShelves}
            max={limits.maxShelves}
            onChange={(shelves) => onChange({ shelves })}
            testId="shelf-count"
          />
        </div>

        {/* Orientation (V2.6) — only on an edge section, and only the corner
            of its own edge: a middle section is always straight, so it gets
            no control at all. The same section, turned 90° backward — no
            price or component changes. */}
        {corners.length > 1 && (
          <label className={GRID_FIELD}>
            <span className={FIELD_LABEL}>{t(CF['CF-120'], locale)}</span>
            <select
              value={section.corner}
              data-section-index={index}
              aria-label={t(CF['CF-124'], locale, { N: index + 1 })}
              onChange={(e) => onChange({ corner: e.target.value as SectionCorner })}
              className={`${SELECT_CLASS} !font-sans`}
            >
              {corners.map((corner) => (
                <option key={corner} value={corner}>
                  {t(CORNER_LABELS[corner], locale)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Walls, then the section's own option. */}
      <div className="flex flex-col gap-2">
        {/* Wraps instead of squeezing: three chips per line where they fit,
            never a label broken mid-word. */}
        <div className="flex flex-wrap gap-2 [&>*]:flex-1 [&>*]:basis-[4.75rem]">
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
    </div>
  );
}

/** A native checkbox inside a chip-shaped label: the whole chip is the
 * touch target, and the checked state reads from the tick and the darker
 * border together — never from colour alone. */
function WallCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label
      className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2 text-[13px] leading-tight transition-colors lg:min-h-10 ${
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
