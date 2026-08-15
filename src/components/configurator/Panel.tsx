import type { ReactNode } from 'react';

export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-2.5 border border-line bg-surface p-3 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base leading-tight">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-steel">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
