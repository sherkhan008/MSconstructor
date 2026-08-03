import type { ReactNode } from 'react';

type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'blueprint';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-steel border-line',
  accent: 'bg-accent-soft text-foreground border-accent',
  success: 'bg-success-soft text-success border-success',
  danger: 'bg-danger-soft text-danger border-danger',
  blueprint: 'bg-blueprint-soft text-blueprint border-blueprint',
};

export function Badge({ children, tone = 'neutral', className = '' }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span
      className={`tech-label inline-flex items-center gap-1 border px-2 py-1 ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
