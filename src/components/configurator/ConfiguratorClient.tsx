'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { trackEvent } from '@/lib/analytics';
import { parseConfigurationFromSearchParams } from '@/lib/configurator/url';
import { DEFAULT_CONFIGURATION, useConfiguratorStore } from '@/store/configurator-store';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import { ShelvingPreview } from './ShelvingPreview';
import { TopShelvingPreview } from './TopShelvingPreview';
import { ParametersSectionsTable } from './ParametersSectionsTable';
import { AdvancedSettingsAccordion } from './AdvancedSettingsAccordion';
import { OrderSummaryBar } from './OrderSummaryBar';
import { BomTable } from './BomTable';
import { useLivePrice } from './useLivePrice';
import type { DimensionAxis } from './resize/dimension-scale';

type PreviewMode = 'front' | 'top';

export function ConfiguratorClient({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const activeSectionId = useConfiguratorStore((s) => s.activeSectionId);
  const setActiveSectionId = useConfiguratorStore((s) => s.setActiveSectionId);
  const addSection = useConfiguratorStore((s) => s.addSection);
  const removeSection = useConfiguratorStore((s) => s.removeSection);
  const updateSection = useConfiguratorStore((s) => s.updateSection);
  const setField = useConfiguratorStore((s) => s.setField);
  const setMany = useConfiguratorStore((s) => s.setMany);
  const loadFromPartial = useConfiguratorStore((s) => s.loadFromPartial);
  const priceResult = useConfiguratorStore((s) => s.priceResult);
  const pricingError = useConfiguratorStore((s) => s.pricingError);
  const hydrated = useConfiguratorStore((s) => s.hydrated);
  const searchParams = useSearchParams();
  const appliedShareLink = useRef(false);
  const openedTracked = useRef(false);

  // View-only state — deliberately never touches config/URL/pricing. See
  // OrderSummaryBar/useLivePrice: only `config` drives price recalculation,
  // so switching preview mode is guaranteed to trigger zero pricing requests.
  const [previewMode, setPreviewMode] = useState<PreviewMode>('front');

  useLivePrice(config);

  useEffect(() => {
    if (appliedShareLink.current) return;
    appliedShareLink.current = true;
    if (searchParams.has('model')) {
      const partial = parseConfigurationFromSearchParams(searchParams);
      loadFromPartial(partial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (openedTracked.current) return;
    openedTracked.current = true;
    trackEvent('configurator_opened');
  }, []);

  // The customer configurator offers MS Standard only — no model selector.
  // A persisted config from before this change (or a shared URL) can still
  // reference another model, leftover accessories, or a non-default colour;
  // none of those are editable here anymore, so normalize them once the
  // persisted store (and any share-link) has finished loading, rather than
  // leaving the configurator stuck on an invalid/orphaned selection.
  useEffect(() => {
    if (!hydrated) return;
    const standard = catalog.models.find((m) => m.slug === 'ms-standard');
    if (!standard) return;

    const needsFix =
      config.modelSlug !== standard.slug ||
      !standard.heights.includes(config.height) ||
      !standard.depths.includes(config.depth) ||
      !standard.shelfTypes.includes(config.shelfType) ||
      !standard.loadCapacities.includes(config.loadCapacity) ||
      config.shelves < standard.minShelves ||
      config.shelves > standard.maxShelves ||
      config.sections.some((s) => !standard.widths.includes(s.width)) ||
      config.accessories.length > 0 ||
      config.colorId !== DEFAULT_CONFIGURATION.colorId;
    if (!needsFix) return;

    setMany({
      modelSlug: standard.slug,
      height: standard.heights.includes(config.height) ? config.height : standard.heights[0],
      depth: standard.depths.includes(config.depth) ? config.depth : standard.depths[0],
      shelfType: standard.shelfTypes.includes(config.shelfType) ? config.shelfType : standard.shelfTypes[0],
      loadCapacity: standard.loadCapacities.includes(config.loadCapacity) ? config.loadCapacity : standard.loadCapacities[0],
      shelves: Math.min(Math.max(config.shelves, standard.minShelves), standard.maxShelves),
      sections: config.sections.map((s) => ({ ...s, width: standard.widths.includes(s.width) ? s.width : standard.widths[0] })),
      accessories: [],
      colorId: DEFAULT_CONFIGURATION.colorId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, config.modelSlug]);

  const color = catalog.colors.find((c) => c.id === config.colorId);
  const model = catalog.models.find((m) => m.slug === config.modelSlug);

  function handleCommitDimension(axis: DimensionAxis, value: number) {
    if (axis === 'width') {
      updateSection(activeSectionId, { width: value });
    } else {
      setField(axis, value);
    }
  }

  // "+" above a section inserts after that specific section, "−" below it
  // removes that specific section — both reuse the existing store actions
  // (addSection always inserts after the currently active section, so we set
  // that section active first) rather than inventing new business logic.
  function handleAddSectionAfter(id: string) {
    setActiveSectionId(id);
    addSection();
  }
  function handleRemoveSectionAt(id: string) {
    removeSection(id);
  }

  return (
    <div className="pb-40 lg:pb-28">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="font-display text-xl sm:text-2xl">Конфигуратор стеллажей МС Стандарт</h1>
          <div className="inline-flex self-start border border-line" role="group" aria-label="Режим просмотра">
            <button
              type="button"
              aria-pressed={previewMode === 'front'}
              onClick={() => setPreviewMode('front')}
              className={`px-3 py-1.5 text-sm transition-colors ${previewMode === 'front' ? 'bg-foreground text-background' : 'hover:bg-surface-muted'}`}
            >
              Вид спереди
            </button>
            <button
              type="button"
              aria-pressed={previewMode === 'top'}
              onClick={() => setPreviewMode('top')}
              className={`border-l border-line px-3 py-1.5 text-sm transition-colors ${previewMode === 'top' ? 'bg-foreground text-background' : 'hover:bg-surface-muted'}`}
            >
              Вид сверху
            </button>
          </div>
        </header>

        {previewMode === 'front' ? (
          <ShelvingPreview
            config={config}
            color={color}
            className="aspect-[16/10] sm:min-h-[380px] lg:min-h-[460px]"
            interactive
            allowedDimensions={model ? { heights: model.heights, widths: model.widths, depths: model.depths } : undefined}
            activeSectionId={activeSectionId}
            onSelectSection={setActiveSectionId}
            onAddSectionAfter={handleAddSectionAfter}
            onRemoveSectionAt={handleRemoveSectionAt}
            onCommitDimension={handleCommitDimension}
            minShelves={model?.minShelves ?? 2}
            maxShelves={model?.maxShelves ?? 8}
            onIncreaseShelves={() => setField('shelves', Math.min(model?.maxShelves ?? 8, config.shelves + 1))}
            onDecreaseShelves={() => setField('shelves', Math.max(model?.minShelves ?? 2, config.shelves - 1))}
          />
        ) : (
          <TopShelvingPreview
            config={config}
            color={color}
            className="sm:min-h-[240px]"
            interactive
            activeSectionId={activeSectionId}
            onSelectSection={setActiveSectionId}
          />
        )}

        <ParametersSectionsTable catalog={catalog} />

        <AdvancedSettingsAccordion catalog={catalog} />

        {priceResult && <BomTable lines={priceResult.bom} totalWeightKg={priceResult.totalWeightKg} />}

        {pricingError && (
          <div className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">{pricingError.message}</div>
        )}
        {priceResult && priceResult.warnings.length > 0 && (
          <ul className="tech-label space-y-1 border border-line bg-surface-muted px-4 py-3">
            {priceResult.warnings.map((warning) => (
              <li key={warning}>⚠ {warning}</li>
            ))}
          </ul>
        )}
      </div>

      <OrderSummaryBar catalog={catalog} />
    </div>
  );
}
