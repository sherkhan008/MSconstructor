import type { ReactNode } from 'react';
import { Container } from './Container';

type Tone = 'white' | 'default' | 'muted' | 'dark';

const TONE_CLASSES: Record<Tone, string> = {
  white: 'bg-surface',
  default: 'bg-background',
  muted: 'bg-surface-muted',
  // Focus rings switch to amber on dark: the default blueprint outline is
  // too low-contrast against graphite.
  dark: 'bg-surface-dark text-background [&_:focus-visible]:outline-accent',
};

/**
 * One storefront section: full-bleed background band, shared vertical rhythm,
 * standard container. `labelledBy` points at the section's heading id so the
 * landmark has an accessible name.
 */
export function Section({
  children,
  tone = 'default',
  id,
  labelledBy,
  className = '',
  containerClassName = '',
}: {
  children: ReactNode;
  tone?: Tone;
  id?: string;
  labelledBy?: string;
  className?: string;
  containerClassName?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`${TONE_CLASSES[tone]} ${className}`}>
      <Container className={`py-16 sm:py-20 lg:py-24 ${containerClassName}`}>{children}</Container>
    </section>
  );
}

/** Section heading block: optional kicker, H2, optional lead and a trailing action. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
  dark = false,
}: {
  id?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  dark?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      <div className="max-w-3xl">
        {eyebrow && <p className={`eyebrow mb-3 ${dark ? '!text-steel-soft' : ''}`}>{eyebrow}</p>}
        <h2 id={id} className="font-display text-3xl sm:text-4xl lg:text-[2.75rem]">
          {title}
        </h2>
        {description && (
          <p className={`mt-4 max-w-2xl text-base sm:text-lg ${dark ? 'text-steel-soft' : 'text-steel'}`}>{description}</p>
        )}
      </div>
      {/* `contents` at mobile: when `action`'s own element is conditionally
          `hidden` there (see the "how it works" CTA on the homepage), this
          wrapper must not still occupy a flex gutter for an invisible child.
          `display: contents` removes the wrapper from the box tree so the
          gap collapses along with it; at sm+ it becomes a normal flex item
          again. */}
      {action && <div className="contents sm:block sm:shrink-0">{action}</div>}
    </div>
  );
}
