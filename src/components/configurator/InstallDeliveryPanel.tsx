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
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] leading-tight text-steel">{t(CF['CF-050'], locale)}</span>
        <select
          value={config.assemblyId}
          onChange={(e) => setField('assemblyId', e.target.value)}
          className="h-11 w-full min-w-0 border border-line bg-surface px-2.5 text-sm outline-none transition-colors hover:border-line-strong focus:border-blueprint lg:h-10"
        >
          {catalog.assemblyServices.map((service) => (
            <option key={service.id} value={service.id}>
              {pick(service.name, locale)}
            </option>
          ))}
        </select>
        {selectedAssembly && pick(selectedAssembly.description, locale) && (
          <span className="text-[13px] leading-snug text-steel">{pick(selectedAssembly.description, locale)}</span>
        )}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] leading-tight text-steel">{t(CF['CF-051'], locale)}</span>
        <select
          value={config.deliveryId}
          onChange={(e) => setField('deliveryId', e.target.value)}
          className="h-11 w-full min-w-0 border border-line bg-surface px-2.5 text-sm outline-none transition-colors hover:border-line-strong focus:border-blueprint lg:h-10"
        >
          {catalog.deliveryMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {pick(method.name, locale)}
            </option>
          ))}
        </select>
        {selectedDelivery && pick(selectedDelivery.description, locale) && (
          <span className="text-[13px] leading-snug text-steel">{pick(selectedDelivery.description, locale)}</span>
        )}
      </label>

      <p className="text-[13px] leading-snug text-steel">{t(CF['CF-052'], locale)}</p>
    </div>
  );
}
