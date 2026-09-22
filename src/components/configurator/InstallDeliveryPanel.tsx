'use client';

import { useConfiguratorStore } from '@/store/configurator-store';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import { pick, t } from '@/lib/i18n/format';
import { CF } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

/** Content-only — the disclosure toggle lives in AdvancedSettingsAccordion. */
export function InstallDeliveryPanel({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const setField = useConfiguratorStore((s) => s.setField);
  const locale = useLocale();

  const selectedAssembly = catalog.assemblyServices.find((s) => s.id === config.assemblyId);
  const selectedDelivery = catalog.deliveryMethods.find((d) => d.id === config.deliveryId);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="tech-label">{t(CF['CF-050'], locale)}</span>
        <select
          value={config.assemblyId}
          onChange={(e) => setField('assemblyId', e.target.value)}
          className="mono h-9 w-full border border-line bg-surface px-2 text-sm outline-none focus:border-blueprint"
        >
          {catalog.assemblyServices.map((service) => (
            <option key={service.id} value={service.id}>
              {pick(service.name, locale)}
            </option>
          ))}
        </select>
        {selectedAssembly && pick(selectedAssembly.description, locale) && (
          <span className="text-xs text-steel">{pick(selectedAssembly.description, locale)}</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="tech-label">{t(CF['CF-051'], locale)}</span>
        <select
          value={config.deliveryId}
          onChange={(e) => setField('deliveryId', e.target.value)}
          className="mono h-9 w-full border border-line bg-surface px-2 text-sm outline-none focus:border-blueprint"
        >
          {catalog.deliveryMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {pick(method.name, locale)}
            </option>
          ))}
        </select>
        {selectedDelivery && pick(selectedDelivery.description, locale) && (
          <span className="text-xs text-steel">{pick(selectedDelivery.description, locale)}</span>
        )}
      </label>

      <p className="text-xs text-steel">{t(CF['CF-052'], locale)}</p>
    </div>
  );
}
