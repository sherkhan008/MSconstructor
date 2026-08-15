'use client';

import { useState } from 'react';
import type { BomLine } from '@/lib/types/domain';

const PREVIEW_ROW_COUNT = 5;

/**
 * Compact, customer-facing BOM list: name left, quantity right, no
 * technical columns (SKU, unit/line price, component type). Pricing stays
 * server-authoritative and lives only in OrderSummaryBar — this component
 * only renders the BOM lines it's given.
 */
export function BomTable({ lines }: { lines: Omit<BomLine, 'unitCost'>[]; totalWeightKg: number }) {
  const [showAll, setShowAll] = useState(false);

  if (lines.length === 0) return null;

  const visibleLines = showAll ? lines : lines.slice(0, PREVIEW_ROW_COUNT);
  const canExpand = lines.length > PREVIEW_ROW_COUNT;

  return (
    <div className="border border-line bg-surface">
      <h3 className="tech-label px-3 py-2.5">Состав комплекта</h3>
      <div className="flex flex-col divide-y divide-line border-t border-line">
        {visibleLines.map((line, i) => (
          <div key={`${line.componentId}-${i}`} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1 break-words">{line.name}</span>
            <span className="mono shrink-0 text-steel">{line.quantity} шт.</span>
          </div>
        ))}
      </div>
      {canExpand && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="tech-label w-full border-t border-line px-3 py-2 text-center hover:bg-surface-muted"
        >
          {showAll ? 'Свернуть ▴' : `Показать весь состав (${lines.length}) ▾`}
        </button>
      )}
    </div>
  );
}
