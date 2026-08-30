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

type ProductModel = PublicCatalog['models'][number];
type WallField = 'rearWall' | 'leftWall' | 'rightWall';

/**
 * Compact, table-like replacement for the old GeneralSettingsPanel +
 * SectionTable pair: one narrow "row parameters" column (height, depth,
 * shelves, load) next to one column per section (width, walls), styled
 * after paksmet.ru's konfig-2 layout (visual reference only — no copied
 * markup/code). Reuses the exact same store state/actions those two
 * components used; no new configuration state is introduced.
 *
 * A single flat list of "blocks" (params block, one block per section, add
 * block) is rendered once and reflowed by CSS alone (flex-col on mobile,
 * grid on desktop) — every control (select, checkbox, button) exists exactly
 * once in the DOM, so plain CSS-attribute locators used by existing e2e
 * tests (e.g. `select[aria-label="Ширина секции 1"]`) never see duplicates.
 */
export function ParametersSectionsTable({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const activeSectionId = useConfiguratorStore((s) => s.activeSectionId);
  const setActiveSectionId = useConfiguratorStore((s) => s.setActiveSectionId);
  const addSection = useConfiguratorStore((s) => s.addSection);
  const removeSection = useConfiguratorStore((s) => s.removeSection);
  const updateSection = useConfiguratorStore((s) => s.updateSection);
  const setField = useConfiguratorStore((s) => s.setField);

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
  const n = config.sections.length;

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
      <div
        className="flex flex-col divide-y divide-line lg:grid lg:divide-y-0"
        style={{ gridTemplateColumns: `minmax(150px,1fr) repeat(${n}, minmax(100px,1fr)) 44px` }}
      >
        <div className="p-3 lg:border-r lg:border-line">
          <span className="tech-label mb-2 block">Параметры ряда</span>
          <RowParamsFields config={config} model={model} catalog={catalog} setField={setField} />
        </div>

        {config.sections.map((section, i) => (
          <div key={section.id} className="p-3 lg:border-r lg:border-line">
            <div className="mb-2 flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={() => setActiveSectionId(section.id)}
                className={`tech-label ${section.id === activeSectionId ? 'text-dimension-accent' : 'text-steel hover:text-foreground'}`}
              >
                Секция {i + 1}
              </button>
              <button
                type="button"
                disabled={!canRemove}
                onClick={() => removeSection(section.id)}
                aria-label="Удалить секцию"
                title="Удалить секцию"
                className="grid h-6 w-6 shrink-0 place-items-center text-steel hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
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
          </div>
        ))}

        <div className="flex items-center justify-center p-3 lg:p-1">
          <button
            type="button"
            disabled={!canAdd}
            onClick={addSection}
            aria-label="Добавить секцию"
            title="Добавить секцию"
            className="tech-label flex w-full items-center justify-center gap-1.5 border border-dimension-accent py-2 text-dimension-accent hover:bg-dimension-accent-soft disabled:cursor-not-allowed disabled:opacity-30 lg:h-7 lg:w-7 lg:rounded-full lg:border lg:p-0"
          >
            <span className="lg:hidden">+ Секция</span>
            <span className="hidden lg:inline">+</span>
          </button>
        </div>
      </div>

      {!canAdd && <p className="tech-label px-3 py-2 text-dimension-accent">Достигнуто максимальное количество секций.</p>}
    </div>
  );
}

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

  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1">
        <span className="tech-label">Высота</span>
        <select
          value={config.height}
          onChange={(e) => setField('height', Number(e.target.value))}
          className="mono h-9 w-full border border-line bg-surface px-2 text-sm outline-none focus:border-blueprint"
        >
          {catalog.heights
            .filter((h) => allowedHeights.includes(h.value))
            .map((h) => (
              <option key={h.id} value={h.value}>
                {h.label}
              </option>
            ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="tech-label">Глубина</span>
        <select
          value={config.depth}
          onChange={(e) => setField('depth', Number(e.target.value))}
          className="mono h-9 w-full border border-line bg-surface px-2 text-sm outline-none focus:border-blueprint"
        >
          {catalog.depths
            .filter((d) => allowedDepths.includes(d.value))
            .map((d) => (
              <option key={d.id} value={d.value}>
                {d.label}
              </option>
            ))}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span className="tech-label">Полки</span>
        <NumberStepper value={config.shelves} min={shelvesMin} max={shelvesMax} onChange={(v) => setField('shelves', v)} testId="shelf-count" />
      </div>

      <label className="flex flex-col gap-1">
        <span className="tech-label">Нагрузка</span>
        <select
          value={config.loadCapacity}
          onChange={(e) => setField('loadCapacity', Number(e.target.value))}
          className="mono h-9 w-full border border-line bg-surface px-2 text-sm outline-none focus:border-blueprint"
        >
          {catalog.loadCapacities.map((load) => {
            const modelCompatible = model.loadCapacities.includes(load.value);
            const dimensionCompatible = config.sections.every((s) => s.width <= load.maxWidth) && config.depth <= load.maxDepth;
            const disabled = !modelCompatible || !dimensionCompatible;
            return (
              <option key={load.id} value={load.value} disabled={disabled}>
                {load.label}
                {disabled ? ' (недоступно)' : ''}
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
  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1">
        <span className="tech-label">Ширина</span>
        <select
          value={section.width}
          data-section-index={index}
          aria-label={`Ширина секции ${index + 1}`}
          onClick={onFocus}
          onChange={(e) => onChangeWidth(Number(e.target.value))}
          className="mono h-9 w-full border border-line bg-surface px-1 text-center text-sm outline-none focus:border-blueprint"
        >
          {widths.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <WallCheckbox label="Задняя" checked={section.rearWall} onFocus={onFocus} onChange={(checked) => onToggleWall('rearWall', checked)} />
        <WallCheckbox label="Левая" checked={section.leftWall} onFocus={onFocus} onChange={(checked) => onToggleWall('leftWall', checked)} />
        <WallCheckbox label="Правая" checked={section.rightWall} onFocus={onFocus} onChange={(checked) => onToggleWall('rightWall', checked)} />
      </div>
    </div>
  );
}

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
    <label className="flex items-center justify-between gap-2 text-xs text-steel">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[color:var(--color-dimension-accent)]"
      />
    </label>
  );
}
