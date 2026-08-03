'use client';

import { useConfiguratorStore } from '@/store/configurator-store';
import { NumberStepper } from '../NumberStepper';
import { OptionCard } from '../OptionCard';
import { StepShell, FieldGroup } from '../StepShell';

const TYPE_OPTIONS: { value: 'SINGLE' | 'MULTIPLE_INDEPENDENT' | 'STARTER_WITH_EXTENSIONS' | 'CONTINUOUS_ROW'; label: string; sublabel: string; minSections: number }[] = [
  { value: 'SINGLE', label: 'Одна секция', sublabel: 'Отдельно стоящий стеллаж', minSections: 1 },
  { value: 'MULTIPLE_INDEPENDENT', label: 'Несколько независимых', sublabel: 'Каждая секция — свои стойки', minSections: 1 },
  { value: 'STARTER_WITH_EXTENSIONS', label: 'Стартовая + пристройки', sublabel: 'Общие стойки между секциями', minSections: 2 },
  { value: 'CONTINUOUS_ROW', label: 'Сплошной ряд', sublabel: 'Ряд секций с общими стойками', minSections: 2 },
];

export function SectionsStep() {
  const config = useConfiguratorStore((s) => s.config);
  const setField = useConfiguratorStore((s) => s.setField);
  const setMany = useConfiguratorStore((s) => s.setMany);

  return (
    <StepShell
      title="Конфигурация секций"
      description="Одна секция, несколько независимых секций или ряд с общими стойками между ними."
    >
      <FieldGroup label="Тип конфигурации">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TYPE_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              label={option.label}
              sublabel={option.sublabel}
              selected={config.configurationType === option.value}
              onClick={() =>
                setMany({
                  configurationType: option.value,
                  sections: Math.max(config.sections, option.minSections),
                })
              }
            />
          ))}
          <OptionCard
            label="Г-образная"
            sublabel="Скоро — оставьте заявку менеджеру"
            selected={false}
            disabled
            disabledReason="Пока недоступно онлайн — свяжитесь с менеджером для индивидуального расчёта"
            onClick={() => {}}
          />
          <OptionCard
            label="П-образная"
            sublabel="Скоро — оставьте заявку менеджеру"
            selected={false}
            disabled
            disabledReason="Пока недоступно онлайн — свяжитесь с менеджером для индивидуального расчёта"
            onClick={() => {}}
          />
        </div>
      </FieldGroup>

      <FieldGroup label="Количество секций">
        <NumberStepper
          value={config.sections}
          min={config.configurationType === 'SINGLE' ? 1 : config.configurationType === 'MULTIPLE_INDEPENDENT' ? 1 : 2}
          max={config.configurationType === 'SINGLE' ? 1 : 10}
          onChange={(value) => setField('sections', value)}
          suffix="шт."
        />
        {(config.configurationType === 'STARTER_WITH_EXTENSIONS' || config.configurationType === 'CONTINUOUS_ROW') && (
          <p className="text-xs text-steel">
            Соседние секции используют общие стойки — экономия металла и цены по сравнению с независимыми секциями.
          </p>
        )}
      </FieldGroup>
    </StepShell>
  );
}
