'use client';

import { useConfiguratorStore } from '@/store/configurator-store';
import { OptionCard } from '../OptionCard';
import { StepShell, FieldGroup } from '../StepShell';
import type { PublicCatalog } from '@/lib/data/public-catalog';

export function DimensionsStep({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const setField = useConfiguratorStore((s) => s.setField);
  const model = catalog.models.find((m) => m.slug === config.modelSlug);
  if (!model) return null;

  return (
    <StepShell title="Габариты" description="Высота, ширина и глубина одной секции стеллажа.">
      <FieldGroup label="Высота">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {catalog.heights.map((h) => (
            <OptionCard
              key={h.id}
              label={h.label}
              selected={config.height === h.value}
              disabled={!model.heights.includes(h.value)}
              disabledReason={`Недоступно для модели «${model.name.ru}»`}
              onClick={() => setField('height', h.value)}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="Ширина секции">
        <div className="grid grid-cols-4 gap-2">
          {catalog.widths.map((w) => (
            <OptionCard
              key={w.id}
              label={w.label}
              selected={config.width === w.value}
              disabled={!model.widths.includes(w.value)}
              disabledReason={`Недоступно для модели «${model.name.ru}»`}
              onClick={() => setField('width', w.value)}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="Глубина">
        <div className="grid grid-cols-4 gap-2">
          {catalog.depths.map((d) => (
            <OptionCard
              key={d.id}
              label={d.label}
              selected={config.depth === d.value}
              disabled={!model.depths.includes(d.value)}
              disabledReason={`Недоступно для модели «${model.name.ru}»`}
              onClick={() => setField('depth', d.value)}
            />
          ))}
        </div>
      </FieldGroup>
    </StepShell>
  );
}
