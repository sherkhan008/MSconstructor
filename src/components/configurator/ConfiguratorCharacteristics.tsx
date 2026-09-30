'use client';

import type { ShelvingConfiguration } from '@/lib/types/domain';
import {
  getMaxSectionHeight,
  sectionHeightsSummary,
  sectionShelvesSummary,
  sectionWidthsSummary,
} from '@/lib/configurator/section-dimensions';
import { getRackFootprintMm } from '@/lib/configurator/rack-world';
import { t } from '@/lib/i18n/format';
import { CF, CT, G } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

/**
 * Read-only summary of the current kit, straight from the section model.
 * Where sections differ, each section's own value is listed in row order
 * ("1500 / 2500") — never one invented kit-wide number. The overall size uses
 * the rack's real envelope: its plan width and depth (for a straight rack the
 * summed section widths and the shared depth; with corners (V2.6) the front
 * line including each corner's depth, and the deepest reach backward) and the
 * tallest section. Corners are listed by their own edge.
 */
export function ConfiguratorCharacteristics({ config }: { config: Pick<ShelvingConfiguration, 'sections' | 'depth' | 'loadCapacity'> }) {
  const locale = useLocale();
  const mm = t(G['G-008'], locale);
  const footprint = getRackFootprintMm(config.sections, config.depth);
  const corners = config.sections.flatMap((s) =>
    s.corner === 'LEFT' ? [t(CF['CF-122'], locale)] : s.corner === 'RIGHT' ? [t(CF['CF-123'], locale)] : [],
  );

  const rows: [string, string][] = [
    [t(CF['CF-108'], locale), `${footprint.width} × ${getMaxSectionHeight(config.sections)} × ${footprint.depth} ${mm}`],
    [t(CF['CF-105'], locale), String(config.sections.length)],
    [t(CF['CF-035'], locale), `${sectionWidthsSummary(config.sections)} ${mm}`],
    [t(CF['CF-030'], locale), `${sectionHeightsSummary(config.sections)} ${mm}`],
    [t(CF['CF-032'], locale), sectionShelvesSummary(config.sections)],
    [t(CF['CF-031'], locale), `${config.depth} ${mm}`],
    [t(CF['CF-033'], locale), t(CT['CT-024'], locale, { N: config.loadCapacity })],
  ];
  if (corners.length > 0) rows.splice(2, 0, [t(CF['CF-120'], locale), corners.join(', ')]);

  return (
    <section aria-labelledby="configurator-characteristics-heading" className="rounded-lg bg-background p-4 sm:p-6">
      <h2 id="configurator-characteristics-heading" className="font-display text-lg leading-tight sm:text-xl">
        {t(CF['CF-107'], locale)}
      </h2>
      <dl data-testid="configurator-characteristics" className="mt-3 flex flex-col text-sm sm:mt-4">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-baseline gap-3 rounded-md px-3 py-2 odd:bg-surface">
            <dt className="text-steel">{label}</dt>
            <dd className="mono min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
