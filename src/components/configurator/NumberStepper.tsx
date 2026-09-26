import { t } from '@/lib/i18n/format';
import { CF } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

export function NumberStepper({
  value,
  min,
  max,
  onChange,
  suffix,
  testId,
  decreaseLabel,
  increaseLabel,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  suffix?: string;
  /** Purely a test hook (no visual/behavioral effect) — the current value
   * has no other reliable, style-independent way to query in a test. */
  testId?: string;
  /** Accessible names of −/+ when the generic «Уменьшить»/«Увеличить» would
   * be ambiguous (a second stepper in the same panel). */
  decreaseLabel?: string;
  increaseLabel?: string;
}) {
  const locale = useLocale();
  return (
    <div className="grid h-11 w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-stretch border border-line bg-surface lg:h-10">
      <button
        type="button"
        aria-label={decreaseLabel ?? t(CF['CF-040'], locale)}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="grid place-items-center text-base text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-30"
      >
        −
      </button>
      <div
        data-testid={testId}
        className="mono flex items-center justify-center border-x border-line px-1 text-sm font-semibold"
      >
        {value}
        {suffix && <span className="ml-1 text-xs font-normal text-steel">{suffix}</span>}
      </div>
      <button
        type="button"
        aria-label={increaseLabel ?? t(CF['CF-041'], locale)}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="grid place-items-center text-base text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}
