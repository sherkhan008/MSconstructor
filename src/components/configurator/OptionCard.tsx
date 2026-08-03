import type { ReactNode } from 'react';

export function OptionCard({
  label,
  sublabel,
  selected,
  disabled,
  disabledReason,
  onClick,
  className = '',
}: {
  label: ReactNode;
  sublabel?: ReactNode;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      aria-pressed={selected}
      className={`relative flex min-h-[56px] flex-col items-start justify-center gap-0.5 border px-3 py-2 text-left transition-colors ${
        selected
          ? 'border-blueprint bg-blueprint-soft text-blueprint'
          : disabled
            ? 'cursor-not-allowed border-line bg-surface-muted text-steel-soft opacity-50'
            : 'border-line bg-surface text-foreground hover:border-foreground'
      } ${className}`}
    >
      <span className="mono text-sm font-medium leading-none">{label}</span>
      {sublabel && <span className="tech-label leading-none">{sublabel}</span>}
    </button>
  );
}
