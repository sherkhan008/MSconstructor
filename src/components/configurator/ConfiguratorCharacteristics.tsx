'use client';

import type { ShelvingConfiguration } from '@/lib/types/domain';
import {
  getMaxSectionHeight,
  sectionHeightsSummary,
  sectionShelvesSummary,
  sectionWidthsSummary,
} from '@/lib/configurator/section-dimensions';
import { t } from '@/lib/i18n/format';
import { CF, CT, G } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

/**
 * Read-only summary of the current kit, straight from the section model.
 * Where sections differ, each section's own value is listed in row order
 * ("1500 / 2500") — never one invented kit-wide number. The overall size uses
 * the row's real envelope: the summed section widths, the tallest section and
 * the shared depth.
 */
export function ConfiguratorCharacteristics({ config }: { config: Pick<ShelvingConfiguration, 'sections' | 'depth' | 'loadCapacity'> }) {
  const locale = useLocale();
  const mm = t(G['G-008'], locale);
  const totalWidth = config.sections.reduce((sum, s) => sum + s.width, 0);

  const rows: [string, string][] = [
    [t(CF['CF-108'], locale), `${totalWidth} × ${getMaxSectionHeight(config.sections)} × ${config.depth} ${mm}`],
    [t(CF['CF-105'], locale), String(config.sections.length)],
    [t(CF['CF-035'], locale), `${sectionWidthsSummary(config.sections)} ${mm}`],
    [t(CF['CF-030'], locale), `${sectionHeightsSummary(config.sections)} ${mm}`],
    [t(CF['CF-032'], locale), sectionShelvesSummary(config.sections)],
    [t(CF['CF-031'], locale), `${config.depth} ${mm}`],
    [t(CF['CF-033'], locale), t(CT['CT-024'], locale, { N: config.loadCapacity })],
  ];

  return (
    <section aria-labelledby="configurator-characteristics-heading" className="border border-line bg-surface">
      <h2 id="configurator-characteristics-heading" className="px-4 pb-2 pt-3.5 font-display text-lg leading-tight">
        {t(CF['CF-107'], locale)}
      </h2>
      <dl data-testid="configurator-characteristics" className="flex flex-col divide-y divide-line border-t border-line text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 px-4 py-2">
            <dt className="text-steel">{label}</dt>
            <dd className="mono min-w-0 break-words text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
