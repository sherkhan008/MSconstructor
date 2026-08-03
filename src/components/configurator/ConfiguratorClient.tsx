'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { trackEvent } from '@/lib/analytics';
import { parseConfigurationFromSearchParams } from '@/lib/configurator/url';
import { useConfiguratorStore } from '@/store/configurator-store';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import { ShelvingPreview } from './ShelvingPreview';
import { StepNav, STEP_TITLES } from './StepNav';
import { PricePanel } from './PricePanel';
import { StickyPriceBar } from './StickyPriceBar';
import { useLivePrice } from './useLivePrice';
import { ModelStep } from './steps/ModelStep';
import { DimensionsStep } from './steps/DimensionsStep';
import { ShelvesLoadStep } from './steps/ShelvesLoadStep';
import { SectionsStep } from './steps/SectionsStep';
import { WallsColorStep } from './steps/WallsColorStep';
import { AccessoriesStep } from './steps/AccessoriesStep';
import { InstallDeliveryStep } from './steps/InstallDeliveryStep';
import { SummaryStep } from './steps/SummaryStep';

export function ConfiguratorClient({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const step = useConfiguratorStore((s) => s.step);
  const loadFromPartial = useConfiguratorStore((s) => s.loadFromPartial);
  const priceResult = useConfiguratorStore((s) => s.priceResult);
  const searchParams = useSearchParams();
  const appliedShareLink = useRef(false);
  const openedTracked = useRef(false);
  const lastTrackedStep = useRef<number | null>(null);

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

  useEffect(() => {
    if (lastTrackedStep.current === step) return;
    lastTrackedStep.current = step;
    trackEvent('step_completed', { step, title: STEP_TITLES[step] });
    if (step === STEP_TITLES.length - 1) {
      trackEvent('configuration_completed', { model: config.modelSlug });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const color = catalog.colors.find((c) => c.id === config.colorId);

  const stepComponents = [
    <ModelStep key="model" catalog={catalog} />,
    <DimensionsStep key="dimensions" catalog={catalog} />,
    <ShelvesLoadStep key="shelves" catalog={catalog} />,
    <SectionsStep key="sections" />,
    <WallsColorStep key="walls" catalog={catalog} />,
    <AccessoriesStep key="accessories" catalog={catalog} />,
    <InstallDeliveryStep key="install" catalog={catalog} />,
    <SummaryStep key="summary" catalog={catalog} />,
  ];

  return (
    <div className="pb-24 lg:pb-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <StepNav />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr_360px]">
          <div className="order-2 lg:order-1">
            <ShelvingPreview config={config} color={color} className="aspect-[4/3] lg:sticky lg:top-20" />
            {priceResult && (
              <p className="tech-label mt-2 text-center lg:text-left">
                Общая длина ряда: {priceResult.rowLengthMm} мм
              </p>
            )}
          </div>

          <div className="order-1 lg:order-2">{stepComponents[step]}</div>

          <div className="order-3 hidden lg:block">
            <PricePanel catalog={catalog} className="lg:sticky lg:top-20" />
          </div>
        </div>
      </div>

      <StickyPriceBar catalog={catalog} />
    </div>
  );
}
