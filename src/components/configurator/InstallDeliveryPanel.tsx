'use client';

import { useConfiguratorStore } from '@/store/configurator-store';
import type { PublicCatalog } from '@/lib/data/public-catalog';

/** Content-only — the disclosure toggle lives in AdvancedSettingsAccordion. */
export function InstallDeliveryPanel({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const setField = useConfiguratorStore((s) => s.setField);

  const selectedAssembly = catalog.assemblyServices.find((s) => s.id === config.assemblyId);
  const selectedDelivery = catalog.deliveryMethods.find((d) => d.id === config.deliveryId);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="tech-label">Сборка</span>
        <select
          value={config.assemblyId}
          onChange={(e) => setField('assemblyId', e.target.value)}
          className="mono h-9 w-full border border-line bg-surface px-2 text-sm outline-none focus:border-blueprint"
        >
          {catalog.assemblyServices.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name.ru}
            </option>
          ))}
        </select>
        {selectedAssembly?.description.ru && <span className="text-xs text-steel">{selectedAssembly.description.ru}</span>}
      </label>

      <label className="flex flex-col gap-1">
        <span className="tech-label">Доставка</span>
        <select
          value={config.deliveryId}
          onChange={(e) => setField('deliveryId', e.target.value)}
          className="mono h-9 w-full border border-line bg-surface px-2 text-sm outline-none focus:border-blueprint"
        >
          {catalog.deliveryMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.name.ru}
            </option>
          ))}
        </select>
        {selectedDelivery?.description.ru && <span className="text-xs text-steel">{selectedDelivery.description.ru}</span>}
      </label>

      <p className="text-xs text-steel">Точная стоимость доставки уточняется менеджером после оформления заявки.</p>
    </div>
  );
}
