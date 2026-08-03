'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { formatPrice } from '@/lib/money';
import { trackEvent } from '@/lib/analytics';
import { useConfiguratorStore, STEP_COUNT } from '@/store/configurator-store';
import { useCartStore } from '@/store/cart-store';
import type { PublicCatalog } from '@/lib/data/public-catalog';

export function StickyPriceBar({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const step = useConfiguratorStore((s) => s.step);
  const nextStep = useConfiguratorStore((s) => s.nextStep);
  const priceResult = useConfiguratorStore((s) => s.priceResult);
  const isPricing = useConfiguratorStore((s) => s.isPricing);
  const addItem = useCartStore((s) => s.addItem);
  const router = useRouter();
  const isLastStep = step === STEP_COUNT - 1;
  const model = catalog.models.find((m) => m.slug === config.modelSlug);

  function handlePrimary() {
    if (!isLastStep) {
      nextStep();
      return;
    }
    if (!priceResult) return;
    addItem({
      modelSlug: config.modelSlug,
      modelName: model?.name.ru ?? config.modelSlug,
      configuration: priceResult.configuration,
      priceSnapshot: priceResult,
    });
    trackEvent('product_added_to_cart', { model: config.modelSlug, redirectToOrder: true });
    router.push('/order');
  }

  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-30 hairline border-x-0 border-b-0 bg-surface/95 p-3 backdrop-blur lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="tech-label">Итого</div>
          {priceResult ? (
            <span className={`mono text-lg font-semibold ${isPricing ? 'opacity-60' : ''}`}>
              {formatPrice(priceResult.breakdown.total)}
            </span>
          ) : (
            <span className="mono text-lg text-steel">—</span>
          )}
        </div>
        <Button onClick={handlePrimary} disabled={isLastStep && !priceResult} size="lg" className="flex-1 max-w-[220px]">
          {isLastStep ? 'Оформить заказ' : 'Далее'}
        </Button>
      </div>
    </div>
  );
}
