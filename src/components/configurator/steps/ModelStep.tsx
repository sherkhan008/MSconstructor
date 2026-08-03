'use client';

import { ProductImage } from '@/components/ui/ProductImage';
import { Badge } from '@/components/ui/Badge';
import { useConfiguratorStore } from '@/store/configurator-store';
import { StepShell } from '../StepShell';
import type { PublicCatalog } from '@/lib/data/public-catalog';

export function ModelStep({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const setMany = useConfiguratorStore((s) => s.setMany);

  return (
    <StepShell title="Модель стеллажа" description="Выберите базовую модель — от неё зависят доступные размеры, нагрузка и типы полок.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {catalog.models.map((model) => {
          const selected = model.slug === config.modelSlug;
          return (
            <button
              key={model.slug}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                if (selected) return;
                setMany({
                  modelSlug: model.slug,
                  height: model.heights.includes(config.height) ? config.height : model.heights[0],
                  width: model.widths.includes(config.width) ? config.width : model.widths[0],
                  depth: model.depths.includes(config.depth) ? config.depth : model.depths[0],
                  shelfType: model.shelfTypes.includes(config.shelfType) ? config.shelfType : model.shelfTypes[0],
                  loadCapacity: model.loadCapacities.includes(config.loadCapacity)
                    ? config.loadCapacity
                    : model.loadCapacities[0],
                  shelves: Math.min(Math.max(config.shelves, model.minShelves), model.maxShelves),
                });
              }}
              className={`flex flex-col overflow-hidden border text-left transition-colors ${
                selected ? 'border-blueprint ring-1 ring-blueprint' : 'border-line hover:border-foreground'
              }`}
            >
              <ProductImage src={model.image} alt={model.name.ru} className="h-40 w-full bg-surface-muted object-cover" />
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xl">{model.name.ru}</h3>
                  {selected && <Badge tone="blueprint">Выбрано</Badge>}
                </div>
                <p className="text-sm text-steel">{model.shortDescription.ru}</p>
                <div className="tech-label mt-auto flex flex-wrap gap-2 pt-2">
                  <span>до {model.maxLoadKg} кг/полка</span>
                  <span>·</span>
                  <span>{model.heights.length} высот</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </StepShell>
  );
}
