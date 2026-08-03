'use client';

import { ProductImage } from '@/components/ui/ProductImage';
import { PriceTag } from '@/components/ui/PriceTag';
import { useConfiguratorStore } from '@/store/configurator-store';
import { NumberStepper } from '../NumberStepper';
import { StepShell } from '../StepShell';
import type { PublicCatalog } from '@/lib/data/public-catalog';

export function AccessoriesStep({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const setAccessoryQuantity = useConfiguratorStore((s) => s.setAccessoryQuantity);

  const compatible = catalog.accessories.filter(
    (a) => a.models.length === 0 || a.models.includes(config.modelSlug),
  );

  return (
    <StepShell title="Аксессуары" description="Дополнительные полки, разделители, контейнеры и крепёж — по желанию.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {compatible.map((accessory) => {
          const selection = config.accessories.find((a) => a.accessoryId === accessory.id);
          const quantity = selection?.quantity ?? 0;
          const maxQuantity = accessory.maxQuantityPerSection
            ? accessory.maxQuantityPerSection * config.sections
            : 20;

          return (
            <div key={accessory.id} className="flex items-center gap-3 border border-line p-3">
              <ProductImage
                src={accessory.image}
                alt={accessory.name.ru}
                className="h-14 w-14 shrink-0 bg-surface-muted object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{accessory.name.ru}</p>
                <PriceTag value={accessory.unitPrice} size="sm" />
              </div>
              <NumberStepper
                value={quantity}
                min={0}
                max={maxQuantity}
                onChange={(value) => setAccessoryQuantity(accessory.id, value)}
              />
            </div>
          );
        })}
      </div>
    </StepShell>
  );
}
