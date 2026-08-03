'use client';

import { useConfiguratorStore } from '@/store/configurator-store';
import { OptionCard } from '../OptionCard';
import { StepShell, FieldGroup } from '../StepShell';
import type { PublicCatalog } from '@/lib/data/public-catalog';

export function InstallDeliveryStep({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const setField = useConfiguratorStore((s) => s.setField);

  return (
    <StepShell title="Сборка и доставка" description="Точная стоимость доставки уточняется менеджером после оформления заявки.">
      <FieldGroup label="Сборка">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {catalog.assemblyServices.map((service) => (
            <OptionCard
              key={service.id}
              label={service.name.ru}
              sublabel={service.description.ru}
              selected={config.assemblyId === service.id}
              onClick={() => setField('assemblyId', service.id)}
              className="min-h-[72px]"
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="Доставка">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {catalog.deliveryMethods.map((method) => (
            <OptionCard
              key={method.id}
              label={method.name.ru}
              sublabel={method.description.ru}
              selected={config.deliveryId === method.id}
              onClick={() => setField('deliveryId', method.id)}
              className="min-h-[72px]"
            />
          ))}
        </div>
      </FieldGroup>
    </StepShell>
  );
}
