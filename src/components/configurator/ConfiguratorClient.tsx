'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { trackEvent } from '@/lib/analytics';
import { parseWorkspaceFromSearchParams, workspaceToShareQuery } from '@/lib/configurator/url';
import {
  DEFAULT_CONFIGURATION,
  selectActiveKitPrice,
  selectActiveSectionId,
  selectConfig,
  useConfiguratorStore,
} from '@/store/configurator-store';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import { normalizeMsStandardConfiguration } from '@/lib/pricing/ms-standard-compatibility';
import { getAllowedKitDepths, getAllowedSectionWidths, getSectionLimits } from '@/lib/configurator/section-limits';
import { computeFramedCrops, frameAspectVars, ShelvingPreview } from './ShelvingPreview';
import { TopShelvingPreview } from './TopShelvingPreview';
import { ParametersSectionsTable } from './ParametersSectionsTable';
import { AdvancedSettingsAccordion, CUSTOMER_ACCESSORY_IDS, isStaleCrossBrace } from './AdvancedSettingsAccordion';
import { OrderSummaryBar } from './OrderSummaryBar';
import { BomTable } from './BomTable';
import { useLivePrice } from './useLivePrice';
import type { DimensionAxis } from './resize/dimension-scale';
import { t } from '@/lib/i18n/format';
import { localizePath } from '@/lib/i18n/locales';
import { CF, CT, H } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';
import { registerSwitchQuery } from '@/components/i18n/switch-query';

type PreviewMode = 'front' | 'top';

export function ConfiguratorClient({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore(selectConfig);
  const kits = useConfiguratorStore((s) => s.kits);
  const activeSectionId = useConfiguratorStore(selectActiveSectionId);
  const setActiveSectionId = useConfiguratorStore((s) => s.setActiveSectionId);
  const addSection = useConfiguratorStore((s) => s.addSection);
  const removeSection = useConfiguratorStore((s) => s.removeSection);
  const updateSection = useConfiguratorStore((s) => s.updateSection);
  const setField = useConfiguratorStore((s) => s.setField);
  const patchKit = useConfiguratorStore((s) => s.patchKit);
  const loadWorkspace = useConfiguratorStore((s) => s.loadWorkspace);
  const reset = useConfiguratorStore((s) => s.reset);
  // The ACTIVE kit's last server answer: its kit contents and warnings are
  // what the panels below show (the purchase card covers every kit).
  const { result: priceResult, error: pricingError } = useConfiguratorStore(selectActiveKitPrice);
  const hydrated = useConfiguratorStore((s) => s.hydrated);
  const searchParams = useSearchParams();
  const locale = useLocale();
  const appliedShareLink = useRef(false);
  const openedTracked = useRef(false);

  // View-only state — deliberately never touches config/URL/pricing. See
  // OrderSummaryBar/useLivePrice: only a kit's own configuration drives its
  // price recalculation, so switching preview mode (or the active kit) is
  // guaranteed to trigger zero pricing requests.
  const [previewMode, setPreviewMode] = useState<PreviewMode>('front');

  useLivePrice();

  // A language switch carries the CURRENT workspace (v3 share-link format:
  // every kit, in order, and the active one), not this page's original query
  // — edits are never written back to the URL.
  useEffect(
    () =>
      registerSwitchQuery(() => {
        const state = useConfiguratorStore.getState();
        if (!state.hydrated) return window.location.search;
        const activeIndex = Math.max(0, state.kits.findIndex((k) => k.id === state.activeKitId));
        return `?${workspaceToShareQuery(state.kits.map((k) => k.configuration), activeIndex)}`;
      }),
    [],
  );

  // A configurator link replaces the whole workspace: a v3 link with its
  // kits, an old single-kit link as a one-kit workspace. An invalid link
  // changes nothing.
  useEffect(() => {
    if (appliedShareLink.current) return;
    appliedShareLink.current = true;
    const link = parseWorkspaceFromSearchParams(searchParams);
    if (link) loadWorkspace(link);
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
  // selection. Depends on every kit's whole configuration, not just
  // `modelSlug`: a share link can carry the *same* modelSlug (there's only
  // ever one, ms-standard) alongside a now-invalid height/depth/width/
  // shelf combination — loadWorkspace's own state update lands in a
  // *separate* commit from this effect's first run, so watching only
  // modelSlug would silently miss dimension-only staleness entirely. Safe
  // against a loop: needsFix (normalizedKitPatch) is a pure value comparison
  // against the already-normalized result, so once patchKit applies it, the
  // next run of this same effect (`kits` changes on every store update)
  // finds nothing to fix and does nothing further.
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
  //
  // Every kit is normalized, not only the active one: each kit is priced on
  // its own, so a stale kit that is not on screen must not sit there as a
  // pricing error until the customer happens to open it.
  useEffect(() => {
    if (!hydrated) return;
    for (const kit of kits) {
      const patch = normalizedKitPatch(kit.configuration, catalog);
      if (patch) patchKit(kit.id, patch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, kits]);

  const color = catalog.colors.find((c) => c.id === config.colorId);
  const model = catalog.models.find((m) => m.slug === config.modelSlug);

  // Same rules the section controls use (see section-limits.ts), for the
  // ACTIVE section only: height drag may only snap to a height whose shelf
  // ceiling fits THAT section's shelf count, width drag only to a width valid
  // for the shared depth, and the preview's shelf +/- stays within THAT
  // section's own height ceiling. No range here reads another section.
  const activeSection = config.sections.find((s) => s.id === activeSectionId) ?? config.sections[0];
  const activeLimits = model ? getSectionLimits(model, activeSection) : undefined;
  const allowedDimensions = activeLimits
    ? {
        heights: activeLimits.heights,
        widths: model ? getAllowedSectionWidths(model, config.depth) : [],
        depths: model ? getAllowedKitDepths(model, config.sections) : [],
      }
    : undefined;
  // The model's largest catalog dimensions — the preview reserves room for
  // them, so its physical scale never changes during or after a drag.
  const capacityMm =
    model && model.widths.length > 0 && model.heights.length > 0 && model.depths.length > 0
      ? { width: Math.max(...model.widths), height: Math.max(...model.heights), depth: Math.max(...model.depths) }
      : undefined;

  // Width and height belong to the section being resized: the active one,
  // read from the store at commit time so a selection made in the same
  // gesture (pressing another section's top edge) is always the one changed.
  function handleCommitDimension(axis: DimensionAxis, value: number) {
    const targetId = selectActiveSectionId(useConfiguratorStore.getState());
    if (axis === 'width') {
      updateSection(targetId, { width: value });
    } else if (axis === 'height') {
      updateSection(targetId, { height: value });
    } else {
      setField(axis, value);
    }
  }

  function handleStepShelves(delta: 1 | -1) {
    if (!activeLimits) return;
    const shelves = Math.min(activeLimits.maxShelves, Math.max(activeLimits.minShelves, activeSection.shelves + delta));
    if (shelves !== activeSection.shelves) updateSection(activeSection.id, { shelves });
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

  // The top view's frame takes the front view's own ratio, so switching
  // preview mode never changes the workspace's size (view-only; config is
  // only read).
  const topFrameStyle = frameAspectVars(computeFramedCrops(config.sections, config.depth, capacityMm));

  // Page order, one full-width column at every breakpoint: breadcrumbs, title
  // and a one-line lead → the rack (the page's centrepiece, at the content
  // width) → the purchase bar → the kit switcher and the active kit's
  // parameters → its sections → additional parameters → kit contents. Below
  // `lg` OrderSummaryBar pins itself to the bottom of the viewport; from `lg`
  // it is a horizontal bar in document flow right under the rack, which
  // sticks under the header only once the page has scrolled past it, so it
  // never covers the rack (see its own classes) — one DOM node either way.
  return (
    <div className="pb-40 lg:pb-12">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="pb-4 pt-3 sm:pb-6 sm:pt-5">
          <nav aria-label={t(CF['CF-128'], locale)}>
            <ol className="flex flex-wrap items-center gap-x-2 text-[13px] leading-6 text-steel">
              <li>
                <Link href={localizePath('/', locale)} className="transition-colors hover:text-foreground hover:underline">
                  {t(CT['CT-003'], locale)}
                </Link>
              </li>
              <li aria-hidden="true">›</li>
              <li aria-current="page" className="text-foreground">
                {t(H['H-003'], locale)}
              </li>
            </ol>
          </nav>
          <h1 className="mt-1.5 font-display text-[1.5rem] font-extrabold leading-tight sm:mt-2 sm:text-3xl lg:text-[2.25rem]">{t(CF['CF-002'], locale)}</h1>
          <p className="mt-2 hidden max-w-2xl text-[15px] leading-snug text-steel sm:block">{t(CF['CF-127'], locale)}</p>
        </div>

        <div className="flex flex-col gap-4 sm:gap-6">
          {/* data-fab-avoid: the interactive rack is never covered by the
              floating WhatsApp button (see WhatsAppFloatingButton). */}
          <div className="-mx-4 overflow-hidden border-y border-line bg-surface sm:mx-0 sm:rounded-lg sm:border-x" data-fab-avoid>
            {/* Compact segmented control, not a full-width toolbar: it names
                the two presentation modes and then gets out of the rack's
                way. Both modes render into the identical 4:3 frame below, so
                switching never moves anything else on the page. */}
            <div className="border-b border-line px-3 py-2 sm:px-4">
              <div className="inline-flex max-w-full overflow-hidden rounded-md border border-line" role="group" aria-label={t(CF['CF-003'], locale)}>
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
                allowedDimensions={allowedDimensions}
                capacityMm={capacityMm}
                activeSectionId={activeSectionId}
                onSelectSection={setActiveSectionId}
                onAddSectionAfter={handleAddSectionAfter}
                onRemoveSectionAt={handleRemoveSectionAt}
                onCommitDimension={handleCommitDimension}
                minShelves={activeLimits?.minShelves}
                maxShelves={activeLimits?.maxShelves}
                onIncreaseShelves={() => handleStepShelves(1)}
                onDecreaseShelves={() => handleStepShelves(-1)}
              />
            ) : (
              <div>
                {/* Exactly the front view's frame ratio at every breakpoint
                    (see computeFramedCrops), so switching modes never makes
                    the workspace jump. The drawing itself is unchanged; it
                    fills the frame and keeps its own proportions. */}
                <div className="configurator-frame configurator-frame-box mx-auto flex w-full items-center" style={topFrameStyle}>
                  <TopShelvingPreview
                    config={config}
                    color={color}
                    className="h-full !border-0"
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

          {/* Directly under the rack in document flow from `lg` (it takes
              its own space, never covers the rack); fixed to the bottom of
              the viewport below `lg`. */}
          <OrderSummaryBar catalog={catalog} />

          {/* The kit switcher and kit parameters, then the sections — two
              full-width panels under the rack. */}
          <ParametersSectionsTable catalog={catalog} onReset={reset} />

          <AdvancedSettingsAccordion catalog={catalog} />

          {pricingError && (
            <div role="alert" className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
              {pricingError.message}
            </div>
          )}
          {priceResult && priceResult.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-line bg-surface-muted px-4 py-3 text-[13px] text-steel">
              {priceResult.warnings.map((warning) => (
                <li key={warning}>⚠ {warning}</li>
              ))}
            </ul>
          )}

          {/* The active kit's contents, read-only, at full width. */}
          {priceResult && <BomTable lines={priceResult.bom} totalWeightKg={priceResult.totalWeightKg} />}
        </div>
      </div>
    </div>
  );
}

/**
 * The normalization patch one kit needs against the current catalog (see the
 * effect above), or null when it is already valid. Pure: compares only.
 */
function normalizedKitPatch(config: ShelvingConfiguration, catalog: PublicCatalog): Partial<ShelvingConfiguration> | null {
  const standard = catalog.models.find((m) => m.slug === 'ms-standard');
  if (!standard) return null;

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
  // per-field `standard.heights.includes(...)` check would catch. Each
  // section is normalized with its own height/shelves only.
  const normalizedDims = normalizeMsStandardConfiguration({
    depth: config.depth,
    sections: config.sections,
  });
  const dimsNeedFix =
    normalizedDims.depth !== config.depth ||
    normalizedDims.sections.some((s, i) => {
      const current = config.sections[i];
      return s.width !== current?.width || s.height !== current?.height || s.shelves !== current?.shelves;
    });

  const needsFix =
    config.modelSlug !== standard.slug ||
    dimsNeedFix ||
    !standard.shelfTypes.includes(config.shelfType) ||
    !standard.loadCapacities.includes(config.loadCapacity) ||
    validAccessories.length !== config.accessories.length ||
    config.colorId !== DEFAULT_CONFIGURATION.colorId ||
    !assemblyValid ||
    !deliveryValid;
  if (!needsFix) return null;

  return {
    modelSlug: standard.slug,
    depth: normalizedDims.depth,
    sections: normalizedDims.sections,
    shelfType: standard.shelfTypes.includes(config.shelfType) ? config.shelfType : standard.shelfTypes[0],
    loadCapacity: standard.loadCapacities.includes(config.loadCapacity) ? config.loadCapacity : standard.loadCapacities[0],
    accessories: validAccessories,
    colorId: DEFAULT_CONFIGURATION.colorId,
    assemblyId: assemblyValid ? config.assemblyId : DEFAULT_CONFIGURATION.assemblyId,
    deliveryId: deliveryValid ? config.deliveryId : DEFAULT_CONFIGURATION.deliveryId,
  };
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
