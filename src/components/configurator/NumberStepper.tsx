export function NumberStepper({
  value,
  min,
  max,
  onChange,
  suffix,
  testId,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  suffix?: string;
  /** Purely a test hook (no visual/behavioral effect) — the current value
   * has no other reliable, style-independent way to query in a test. */
  testId?: string;
}) {
  return (
    <div className="inline-flex items-stretch border border-line">
      <button
        type="button"
        aria-label="Уменьшить"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="grid h-11 w-11 place-items-center text-lg text-foreground hover:bg-surface-muted disabled:opacity-30"
      >
        −
      </button>
      <div
        data-testid={testId}
        className="mono flex min-w-[64px] items-center justify-center border-x border-line px-2 text-base font-semibold"
      >
        {value}
        {suffix && <span className="ml-1 text-xs font-normal text-steel">{suffix}</span>}
      </div>
      <button
        type="button"
        aria-label="Увеличить"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="grid h-11 w-11 place-items-center text-lg text-foreground hover:bg-surface-muted disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}
