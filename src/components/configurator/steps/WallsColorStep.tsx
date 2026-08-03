'use client';

import { useConfiguratorStore } from '@/store/configurator-store';
import { OptionCard } from '../OptionCard';
import { StepShell, FieldGroup } from '../StepShell';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import type { RearOption, SideOption } from '@/lib/types/domain';

const REAR_OPTIONS: { value: RearOption; label: string }[] = [
  { value: 'NONE', label: 'Без задней стенки' },
  { value: 'CROSS_BRACE', label: 'Раскосы жёсткости' },
  { value: 'SOLID', label: 'Сплошная стенка' },
  { value: 'PERFORATED', label: 'Перфорированная стенка' },
];

const SIDE_OPTIONS: { value: SideOption; label: string }[] = [
  { value: 'NONE', label: 'Без боковых стенок' },
  { value: 'LEFT', label: 'Левая сплошная' },
  { value: 'RIGHT', label: 'Правая сплошная' },
  { value: 'BOTH', label: 'Обе сплошные' },
  { value: 'LEFT_PERFORATED', label: 'Левая перфорированная' },
  { value: 'RIGHT_PERFORATED', label: 'Правая перфорированная' },
  { value: 'BOTH_PERFORATED', label: 'Обе перфорированные' },
];

export function WallsColorStep({ catalog }: { catalog: PublicCatalog }) {
  const config = useConfiguratorStore((s) => s.config);
  const setField = useConfiguratorStore((s) => s.setField);

  return (
    <StepShell title="Стенки и цвет" description="Задние и боковые стенки повышают жёсткость и защищают содержимое полок.">
      <FieldGroup label="Цвет каркаса">
        <div className="flex flex-wrap gap-3">
          {catalog.colors.map((color) => {
            const selected = config.colorId === color.id;
            return (
              <button
                key={color.id}
                type="button"
                aria-pressed={selected}
                title={color.name.ru}
                onClick={() => setField('colorId', color.id)}
                className={`flex flex-col items-center gap-1.5 border p-2 transition-colors ${
                  selected ? 'border-blueprint bg-blueprint-soft' : 'border-line hover:border-foreground'
                }`}
              >
                <span
                  className="h-8 w-8 border border-line/60"
                  style={{ backgroundColor: color.hex }}
                  aria-hidden="true"
                />
                <span className="tech-label max-w-[72px] text-center leading-tight">{color.name.ru}</span>
                {color.pricePercent > 0 && <span className="mono text-[10px] text-steel">+{color.pricePercent}%</span>}
              </button>
            );
          })}
        </div>
      </FieldGroup>

      <FieldGroup label="Задняя стенка">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {REAR_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              label={option.label}
              selected={config.rear === option.value}
              onClick={() => setField('rear', option.value)}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="Боковые стенки">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SIDE_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              label={option.label}
              selected={config.side === option.value}
              onClick={() => setField('side', option.value)}
            />
          ))}
        </div>
      </FieldGroup>
    </StepShell>
  );
}
