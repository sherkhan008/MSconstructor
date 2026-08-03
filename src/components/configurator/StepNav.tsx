'use client';

import { Button } from '@/components/ui/Button';
import { STEP_COUNT, useConfiguratorStore } from '@/store/configurator-store';

export const STEP_TITLES = [
  'Модель',
  'Габариты',
  'Полки и нагрузка',
  'Секции',
  'Стенки и цвет',
  'Аксессуары',
  'Сборка и доставка',
  'Итог',
];

export function StepNav() {
  const step = useConfiguratorStore((s) => s.step);
  const setStep = useConfiguratorStore((s) => s.setStep);
  const nextStep = useConfiguratorStore((s) => s.nextStep);
  const prevStep = useConfiguratorStore((s) => s.prevStep);

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex items-center gap-1 overflow-x-auto pb-1" aria-label="Шаги конфигуратора">
        {STEP_TITLES.map((title, index) => (
          <li key={title} className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setStep(index)}
              aria-current={index === step ? 'step' : undefined}
              className={`tech-label whitespace-nowrap border px-2.5 py-1.5 transition-colors ${
                index === step
                  ? 'border-blueprint bg-blueprint-soft text-blueprint'
                  : index < step
                    ? 'border-success/50 bg-success-soft text-success'
                    : 'border-line text-steel hover:border-foreground hover:text-foreground'
              }`}
            >
              {index + 1}. {title}
            </button>
            {index < STEP_TITLES.length - 1 && <span className="h-px w-3 bg-line" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <div className="hidden items-center justify-between lg:flex">
        <Button variant="outline" onClick={prevStep} disabled={step === 0}>
          ← Назад
        </Button>
        <Button variant="outline" onClick={nextStep} disabled={step === STEP_COUNT - 1}>
          Далее →
        </Button>
      </div>
    </div>
  );
}
