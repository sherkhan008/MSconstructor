'use client';

import { useState } from 'react';
import { useConfiguratorStore } from '@/store/configurator-store';
import { NumberStepper } from '../NumberStepper';
import { BomTable } from '../BomTable';
import { StepShell, FieldGroup } from '../StepShell';
import type { PublicCatalog } from '@/lib/data/public-catalog';

export function SummaryStep({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const setField = useConfiguratorStore((s) => s.setField);
  const priceResult = useConfiguratorStore((s) => s.priceResult);
  const pricingError = useConfiguratorStore((s) => s.pricingError);
  const [promoInput, setPromoInput] = useState(config.promoCode ?? '');

  const model = catalog.models.find((m) => m.slug === config.modelSlug);
  const color = catalog.colors.find((c) => c.id === config.colorId);

  return (
    <StepShell title="Итог конфигурации" description="Проверьте параметры, при необходимости укажите промокод и количество комплектов.">
      <div className="grid grid-cols-2 gap-3 border border-line p-4 sm:grid-cols-4">
        <SummaryFact label="Модель" value={model?.name.ru ?? config.modelSlug} />
        <SummaryFact label="Размеры" value={`${config.height}×${config.width}×${config.depth} мм`} />
        <SummaryFact label="Полки" value={`${config.shelves} шт.`} />
        <SummaryFact label="Секции" value={`${config.sections} шт.`} />
        <SummaryFact label="Нагрузка" value={`${config.loadCapacity} кг/полка`} />
        <SummaryFact label="Цвет" value={color?.name.ru ?? '—'} />
        <SummaryFact label="Задняя стенка" value={REAR_LABEL[config.rear]} />
        <SummaryFact label="Боковые стенки" value={SIDE_LABEL[config.side]} />
      </div>

      {priceResult && <BomTable lines={priceResult.bom} totalWeightKg={priceResult.totalWeightKg} />}

      {pricingError && (
        <div className="border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">{pricingError.message}</div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldGroup label="Количество комплектов">
          <NumberStepper value={config.quantity} min={1} max={200} onChange={(v) => setField('quantity', v)} />
        </FieldGroup>

        <FieldGroup label="Промокод">
          <div className="flex gap-2">
            <input
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
              placeholder="Например, SKLAD2026"
              className="mono h-11 flex-1 border border-line bg-surface px-3 text-sm uppercase outline-none focus:border-blueprint"
            />
            <button
              type="button"
              onClick={() => setField('promoCode', promoInput || undefined)}
              className="border border-foreground px-4 text-sm font-medium hover:bg-foreground hover:text-background"
            >
              Применить
            </button>
          </div>
          {priceResult && priceResult.breakdown.discountReasons.length > 0 && (
            <ul className="text-xs text-success">
              {priceResult.breakdown.discountReasons.map((reason) => (
                <li key={reason}>✓ {reason}</li>
              ))}
            </ul>
          )}
        </FieldGroup>
      </div>

      {priceResult && priceResult.warnings.length > 0 && (
        <ul className="tech-label space-y-1 border border-line bg-surface-muted px-4 py-3">
          {priceResult.warnings.map((warning) => (
            <li key={warning}>⚠ {warning}</li>
          ))}
        </ul>
      )}
    </StepShell>
  );
}

function SummaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tech-label">{label}</div>
      <div className="mono text-sm font-medium">{value}</div>
    </div>
  );
}

const REAR_LABEL: Record<string, string> = {
  NONE: 'нет',
  CROSS_BRACE: 'раскосы',
  SOLID: 'сплошная',
  PERFORATED: 'перфорированная',
};

const SIDE_LABEL: Record<string, string> = {
  NONE: 'нет',
  LEFT: 'левая',
  RIGHT: 'правая',
  BOTH: 'обе',
  LEFT_PERFORATED: 'левая перф.',
  RIGHT_PERFORATED: 'правая перф.',
  BOTH_PERFORATED: 'обе перф.',
};
