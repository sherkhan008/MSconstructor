'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { trackEvent } from '@/lib/analytics';
import { configurationToShareQuery, parseConfigurationFromSearchParams } from '@/lib/configurator/url';
import { DEFAULT_CONFIGURATION, useConfiguratorStore } from '@/store/configurator-store';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import {
  getAllowedDepthsForSections,
  getAllowedHeightsForShelfCount,
  getAllowedWidthsForDepth,
  getMaxShelvesForHeight,
  MS_STANDARD_MIN_SHELVES,
  normalizeMsStandardConfiguration,
} from '@/lib/pricing/ms-standard-compatibility';
import { ShelvingPreview } from './ShelvingPreview';
import { TopShelvingPreview } from './TopShelvingPreview';
import { ParametersSectionsTable } from './ParametersSectionsTable';
import { AdvancedSettingsAccordion, CUSTOMER_ACCESSORY_IDS, isStaleCrossBrace } from './AdvancedSettingsAccordion';
import { OrderSummaryBar } from './OrderSummaryBar';
import { BomTable } from './BomTable';
import { useLivePrice } from './useLivePrice';
import type { DimensionAxis } from './resize/dimension-scale';
import { t } from '@/lib/i18n/format';
import { CF, CT } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';
import { registerSwitchQuery } from '@/components/i18n/switch-query';

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
  const reset = useConfiguratorStore((s) => s.reset);
  const priceResult = useConfiguratorStore((s) => s.priceResult);
  const pricingError = useConfiguratorStore((s) => s.pricingError);
  const hydrated = useConfiguratorStore((s) => s.hydrated);
  const searchParams = useSearchParams();
  const locale = useLocale();
  const appliedShareLink = useRef(false);
  const openedTracked = useRef(false);

  // View-only state — deliberately never touches config/URL/pricing. See
  // OrderSummaryBar/useLivePrice: only `config` drives price recalculation,
  // so switching preview mode is guaranteed to trigger zero pricing requests.
  const [previewMode, setPreviewMode] = useState<PreviewMode>('front');

  useLivePrice(config);

  // A language switch carries the CURRENT configuration (share-link format),
  // not this page's original query — edits are never written back to the URL.
  const latestConfig = useRef(config);
  latestConfig.current = config;
  useEffect(
    () =>
      registerSwitchQuery(() =>
        useConfiguratorStore.getState().hydrated ? `?${configurationToShareQuery(latestConfig.current)}` : window.location.search,
      ),
    [],
  );

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
  // reference another model, an unsupported shelf type, an obsolete
  // dimension, or leftover accessories from the old full admin catalog;
  // none of those are reachable from this UI anymore, so normalize them
  // once the persisted store (and any share-link) has finished loading,
  // rather than leaving the configurator stuck on an invalid/orphaned
  // selection. Depends on the whole `config` object, not just
  // `modelSlug`: a share link can carry the *same* modelSlug (there's only
  // ever one, ms-standard) alongside a now-invalid height/depth/width/
  // shelf combination — loadFromPartial's own state update lands in a
  // *separate* commit from this effect's first run, so watching only
  // modelSlug would silently miss dimension-only staleness entirely. Safe
  // against a loop: needsFix below is a pure value comparison against the
  // already-normalized result, so once setMany applies it, the next run of
  // this same effect (config's reference changes on every store update)
  // computes needsFix=false and does nothing further.
  //
  // Accessories are filtered, not wiped: CUSTOMER_ACCESSORY_IDS is the
  // small set the "Дополнительные параметры" checkboxes actually offer
  // (adjustable feet, shelf reinforcement, cross brace) — those must
  // survive normalization since they are real, intentional customer
  // selections now. Anything else (the old, no-longer-offered accessory
  // panel) still gets stripped, same as before.
  //
  // assemblyId/deliveryId get the same "does this id still exist in the
  // current catalog" check as everything else here — not because the
  // customer configurator restricts them the way it restricts colorId, but
  // because a catalog re-seed/repair (see prisma/seed.ts and
  // scripts/repair-canonical-catalog-ids.ts) renames the underlying
  // database ids these selects store; a persisted config from before that
  // rename must not be left pointing at an id that no longer exists.
  // Falling back to DEFAULT_CONFIGURATION's own values is the "explicitly
  // defined safe default" this is allowed to do — never an arbitrary or
  // fuzzy-matched substitute, and a genuinely valid non-default selection
  // (e.g. professional assembly) is left untouched.
  useEffect(() => {
    if (!hydrated) return;
    const standard = catalog.models.find((m) => m.slug === 'ms-standard');
    if (!standard) return;

    const validAccessories = config.accessories.filter(
      (a) => (CUSTOMER_ACCESSORY_IDS as readonly string[]).includes(a.accessoryId) && !isStaleCrossBrace(a, config.sections),
    );
    const assemblyValid = catalog.assemblyServices.some((a) => a.id === config.assemblyId);
    const deliveryValid = catalog.deliveryMethods.some((d) => d.id === config.deliveryId);

    // The cross-dimensional MS Standard rules (height×shelves, width×depth
    // — see ms-standard-compatibility.ts) replace the old independent
    // flat-list checks: an old persisted config or share link may carry an
    // obsolete height, a depth no longer valid for its own section widths,
    // or a shelf count too high for its height, none of which a simple
    // per-field `standard.heights.includes(...)` check would catch.
    const normalizedDims = normalizeMsStandardConfiguration({
      height: config.height,
      depth: config.depth,
      shelves: config.shelves,
      sections: config.sections,
    });
    const dimsNeedFix =
      normalizedDims.height !== config.height ||
      normalizedDims.depth !== config.depth ||
      normalizedDims.shelves !== config.shelves ||
      normalizedDims.sections.some((s, i) => s.width !== config.sections[i]?.width);

    const needsFix =
      config.modelSlug !== standard.slug ||
      dimsNeedFix ||
      !standard.shelfTypes.includes(config.shelfType) ||
      !standard.loadCapacities.includes(config.loadCapacity) ||
      validAccessories.length !== config.accessories.length ||
      config.colorId !== DEFAULT_CONFIGURATION.colorId ||
      !assemblyValid ||
      !deliveryValid;
    if (!needsFix) return;

    setMany({
      modelSlug: standard.slug,
      height: normalizedDims.height,
      depth: normalizedDims.depth,
      shelves: normalizedDims.shelves,
      sections: normalizedDims.sections,
      shelfType: standard.shelfTypes.includes(config.shelfType) ? config.shelfType : standard.shelfTypes[0],
      loadCapacity: standard.loadCapacities.includes(config.loadCapacity) ? config.loadCapacity : standard.loadCapacities[0],
      accessories: validAccessories,
      colorId: DEFAULT_CONFIGURATION.colorId,
      assemblyId: assemblyValid ? config.assemblyId : DEFAULT_CONFIGURATION.assemblyId,
      deliveryId: deliveryValid ? config.deliveryId : DEFAULT_CONFIGURATION.deliveryId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, config]);

  const color = catalog.colors.find((c) => c.id === config.colorId);
  const model = catalog.models.find((m) => m.slug === config.modelSlug);

  // Same cross-dimensional MS Standard rules the parameter selects use (see
  // ms-standard-compatibility.ts): height drag may only snap to a height
  // whose own shelf ceiling fits the CURRENT shelf count, width drag may
  // only snap to a width valid for the CURRENT global depth, and the
  // preview's own shelf +/- controls follow the CURRENT height's ceiling.
  // Every other model keeps its flat model.heights/widths/minShelves/
  // maxShelves — it has no cross-rules today.
  const isMsStandard = model?.slug === 'ms-standard';
  const allowedHeights = isMsStandard ? getAllowedHeightsForShelfCount(config.shelves) : (model?.heights ?? []);
  const allowedWidths = isMsStandard ? getAllowedWidthsForDepth(config.depth) : (model?.widths ?? []);
  const allowedDepths = isMsStandard ? getAllowedDepthsForSections(config.sections) : (model?.depths ?? []);
  const shelvesMin = isMsStandard ? MS_STANDARD_MIN_SHELVES : (model?.minShelves ?? 2);
  const shelvesMax = isMsStandard ? (getMaxShelvesForHeight(config.height) ?? model?.maxShelves ?? 8) : (model?.maxShelves ?? 8);

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

  // Two-zone workspace: the rack (left, sticky on desktop) is the visual
  // centre; configuration, kit summary and the purchase card share the
  // right column. Below `lg` the same DOM stacks, and OrderSummaryBar pins
  // itself to the bottom of the viewport instead (see its own classes).
  return (
    <div className="pb-40 lg:pb-16">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <h1 className="py-4 font-display text-[1.375rem] leading-tight sm:py-6 sm:text-3xl lg:truncate lg:py-5 lg:text-[2rem] lg:leading-10">{t(CF['CF-002'], locale)}</h1>

        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,380px)] lg:items-start xl:gap-8">
          <div className="-mx-4 border-y border-line bg-surface sm:mx-0 sm:border-x lg:sticky lg:top-[calc(var(--header-height)+1rem)]">
            {/* Compact segmented control, not a full-width toolbar: it names
                the two presentation modes and then gets out of the rack's
                way. Both modes render into the identical 4:3 frame below, so
                switching never moves anything else on the page. */}
            <div className="border-b border-line px-3 py-2 sm:px-4">
              <div className="inline-flex max-w-full border border-line" role="group" aria-label={t(CF['CF-003'], locale)}>
                <ViewToggleButton pressed={previewMode === 'front'} onClick={() => setPreviewMode('front')}>
                  {t(CF['CF-004'], locale)}
                </ViewToggleButton>
                <ViewToggleButton pressed={previewMode === 'top'} onClick={() => setPreviewMode('top')} className="border-l border-line">
                  {t(CF['CF-005'], locale)}
                </ViewToggleButton>
              </div>
            </div>

            {previewMode === 'front' ? (
              <ShelvingPreview
                config={config}
                color={color}
                framed
                frameClassName="configurator-frame"
                interactive
                allowedDimensions={model ? { heights: allowedHeights, widths: allowedWidths, depths: allowedDepths } : undefined}
                activeSectionId={activeSectionId}
                onSelectSection={setActiveSectionId}
                onAddSectionAfter={handleAddSectionAfter}
                onRemoveSectionAt={handleRemoveSectionAt}
                onCommitDimension={handleCommitDimension}
                minShelves={shelvesMin}
                maxShelves={shelvesMax}
                onIncreaseShelves={() => setField('shelves', Math.min(shelvesMax, config.shelves + 1))}
                onDecreaseShelves={() => setField('shelves', Math.max(shelvesMin, config.shelves - 1))}
              />
            ) : (
              <div>
                {/* Exactly the front view's frame ratio at every breakpoint
                    (6:5 on phones, 4:3 from `sm` up), so switching modes never
                    makes the workspace jump. */}
                <div className="configurator-frame mx-auto flex aspect-[6/5] w-full items-center sm:aspect-[4/3]">
                  <TopShelvingPreview
                    config={config}
                    color={color}
                    className="!border-0"
                    interactive
                    activeSectionId={activeSectionId}
                    onSelectSection={setActiveSectionId}
                  />
                </div>
                {/* Same secondary caption strip the front view renders, so
                    the two modes are visibly one component. */}
                <div className="flex justify-end border-t border-line px-3 py-2 text-xs leading-snug text-steel sm:px-4">
                  <p className="mono whitespace-nowrap">{t(CT['CT-024'], locale, { N: config.loadCapacity })}</p>
                </div>
              </div>
            )}
          </div>

          {/* Desktop: one panel sized to the screen below the header and the
              fixed-height (5rem) title — the configuration scrolls inside it
              while the purchase card stays pinned to its foot, so price and
              next step are in view without scrolling the page and never
              cover the controls they summarise. */}
          <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--header-height)+1rem)] lg:max-h-[calc(100dvh-var(--header-height)-6.5rem)] lg:gap-0 lg:border lg:border-line lg:bg-surface">
            <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:gap-0 lg:divide-y lg:divide-line lg:overflow-y-auto lg:overscroll-contain lg:[&>*]:border-0">
            <ParametersSectionsTable catalog={catalog} onReset={reset} />

            <AdvancedSettingsAccordion catalog={catalog} />

            {priceResult && <BomTable lines={priceResult.bom} totalWeightKg={priceResult.totalWeightKg} />}

            {pricingError && (
              <div role="alert" className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
                {pricingError.message}
              </div>
            )}
            {priceResult && priceResult.warnings.length > 0 && (
              <ul className="space-y-1 border border-line bg-surface-muted px-4 py-3 text-[13px] text-steel">
                {priceResult.warnings.map((warning) => (
                  <li key={warning}>⚠ {warning}</li>
                ))}
              </ul>
            )}
            </div>

            <OrderSummaryBar catalog={catalog} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ViewToggleButton({
  pressed,
  onClick,
  className = '',
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-11 min-w-0 px-3 py-1.5 text-xs font-medium leading-tight transition-colors sm:text-[13px] lg:min-h-9 ${
        pressed ? 'bg-foreground text-surface' : 'bg-surface text-steel hover:bg-surface-muted hover:text-foreground'
      } ${className}`}
    >
      {children}
    </button>
  );
}
