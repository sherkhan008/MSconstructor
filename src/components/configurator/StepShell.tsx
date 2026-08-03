import type { ReactNode } from 'react';

export function StepShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-2xl">{title}</h2>
        {description && <p className="mt-1 text-sm text-steel">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="tech-label">{label}</span>
      {children}
    </div>
  );
}
