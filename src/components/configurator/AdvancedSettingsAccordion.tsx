'use client';

import { useState } from 'react';
import { useConfiguratorStore } from '@/store/configurator-store';
import { InstallDeliveryPanel } from './InstallDeliveryPanel';
import type { PublicCatalog } from '@/lib/data/public-catalog';

const SHELF_TYPE_LABEL: Record<string, string> = {
  STANDARD: 'Стандартная',
  REINFORCED: 'Усиленная',
  EXTRA_REINFORCED: 'Особо усиленная',
  PERFORATED: 'Перфорированная',
  GALVANIZED: 'Оцинкованная',
};

/**
 * Single compact, collapsed-by-default disclosure for every secondary
 * customer choice currently in the configurator: shelf type, assembly,
 * delivery. Colour and accessories are not customer-facing choices — the
 * configurator only offers MS Standard, priced with the catalog's default
 * colour and no accessories (see ConfiguratorClient's normalization effect).
 */
export function AdvancedSettingsAccordion({ catalog }: { catalog: PublicCatalog }) {
  const [open, setOpen] = useState(false);
  const config = useConfiguratorStore((s) => s.config);
  const setField = useConfiguratorStore((s) => s.setField);
  const model = catalog.models.find((m) => m.slug === config.modelSlug);

  return (
    <div className="border border-line bg-surface text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="tech-label">Дополнительные параметры</span>
        <span aria-hidden="true" className="text-steel">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && model && (
        <div className="flex flex-col gap-3 border-t border-line p-3">
          <label className="flex flex-col gap-1">
            <span className="tech-label">Тип полки</span>
            <select
              value={config.shelfType}
              onChange={(e) => setField('shelfType', e.target.value as typeof config.shelfType)}
              className="mono h-9 w-full border border-line bg-surface px-2 text-sm outline-none focus:border-blueprint"
            >
              {model.shelfTypes.map((type) => (
                <option key={type} value={type}>
                  {SHELF_TYPE_LABEL[type] ?? type}
                </option>
              ))}
            </select>
          </label>

          <InstallDeliveryPanel catalog={catalog} />
        </div>
      )}
    </div>
  );
}
