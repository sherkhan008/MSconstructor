'use client';

import { useConfiguratorStore } from '@/store/configurator-store';
import { NumberStepper } from '../NumberStepper';
import { OptionCard } from '../OptionCard';
import { StepShell, FieldGroup } from '../StepShell';
import type { PublicCatalog } from '@/lib/data/public-catalog';

const SHELF_TYPE_LABEL: Record<string, string> = {
  STANDARD: 'Стандартная',
  REINFORCED: 'Усиленная',
  EXTRA_REINFORCED: 'Особо усиленная',
  PERFORATED: 'Перфорированная',
  GALVANIZED: 'Оцинкованная',
};

export function ShelvesLoadStep({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const setField = useConfiguratorStore((s) => s.setField);
  const model = catalog.models.find((m) => m.slug === config.modelSlug);
  if (!model) return null;

  return (
    <StepShell title="Полки и нагрузка" description="Количество полок, тип полки и допустимая нагрузка на одну полку.">
      <FieldGroup label={`Количество полок (от ${model.minShelves} до ${model.maxShelves})`}>
        <NumberStepper
          value={config.shelves}
          min={model.minShelves}
          max={model.maxShelves}
          onChange={(value) => setField('shelves', value)}
          suffix="шт."
        />
      </FieldGroup>

      <FieldGroup label="Тип полки">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {model.shelfTypes.map((type) => (
            <OptionCard
              key={type}
              label={SHELF_TYPE_LABEL[type] ?? type}
              selected={config.shelfType === type}
              onClick={() => setField('shelfType', type)}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="Нагрузка на полку">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {catalog.loadCapacities.map((load) => {
            const modelCompatible = model.loadCapacities.includes(load.value);
            const dimensionCompatible = config.width <= load.maxWidth && config.depth <= load.maxDepth;
            const disabled = !modelCompatible || !dimensionCompatible;
            return (
              <OptionCard
                key={load.id}
                label={load.label}
                sublabel={load.note?.ru}
                selected={config.loadCapacity === load.value}
                disabled={disabled}
                disabledReason={
                  !modelCompatible
                    ? `Недоступно для модели «${model.name.ru}»`
                    : `Требуется ширина до ${load.maxWidth} мм и глубина до ${load.maxDepth} мм`
                }
                onClick={() => setField('loadCapacity', load.value)}
              />
            );
          })}
        </div>
      </FieldGroup>
    </StepShell>
  );
}
