'use client';

import { useState } from 'react';
import type { PublicKitLine } from '@/lib/pricing/public-result';
import { t } from '@/lib/i18n/format';
import { CF } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

const PREVIEW_ROW_COUNT = 5;

/**
 * Compact, customer-facing BOM list: name left, quantity right, no
 * technical columns (SKU, unit/line price, component type). Pricing stays
 * server-authoritative and lives only in OrderSummaryBar — this component
 * only renders the BOM lines it's given.
 */
export function BomTable({ lines }: { lines: PublicKitLine[]; totalWeightKg: number }) {
  const [showAll, setShowAll] = useState(false);
  const locale = useLocale();

  if (lines.length === 0) return null;

  const visibleLines = showAll ? lines : lines.slice(0, PREVIEW_ROW_COUNT);
  const canExpand = lines.length > PREVIEW_ROW_COUNT;

  return (
    <div className="rounded-lg bg-background p-4 sm:p-6">
      <h2 className="font-display text-lg leading-tight sm:text-xl">{t(CF['CF-053'], locale)}</h2>
      {/* Full page width from `lg`: two newspaper columns, so a name and
          its quantity never sit a whole page apart. */}
      <div className="mt-3 flex flex-col sm:mt-4 lg:block lg:columns-2 lg:gap-x-8">
        {visibleLines.map((line, i) => (
          <div key={`${line.componentId}-${i}`} className="flex break-inside-avoid items-baseline justify-between gap-3 rounded-md px-3 py-2 text-sm odd:bg-surface">
            <span className="min-w-0 flex-1 break-words">{line.name}</span>
            <span className="mono shrink-0 text-steel">{t(CF['CF-054'], locale, { N: line.quantity })}</span>
          </div>
        ))}
      </div>
      {canExpand && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-2 min-h-11 w-full rounded-md px-4 text-center text-[13px] font-medium text-steel transition-colors hover:bg-surface hover:text-foreground"
        >
          {showAll ? t(CF['CF-055'], locale) : t(CF['CF-056'], locale, { N: lines.length })}
        </button>
      )}
    </div>
  );
}
