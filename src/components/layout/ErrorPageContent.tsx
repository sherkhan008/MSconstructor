import type { ReactNode } from 'react';
import { Container } from '@/components/ui/Container';

/**
 * Body of the public 404 and error pages: a short heading, one sentence and
 * the ways onward, laid out like the order-success page. Deliberately shows
 * no error message, digest or stack — only customer wording.
 */
export function ErrorPageContent({
  code,
  title,
  text,
  children,
}: {
  /** A plain status number shown above the heading (e.g. "404"). */
  code?: string;
  title: string;
  text: string;
  /** The action buttons. */
  children: ReactNode;
}) {
  return (
    <div className="border-b border-line bg-surface">
      <Container className="pb-14 pt-12 sm:pb-20 sm:pt-16">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          {code && <p className="mono text-sm font-semibold tracking-widest text-steel">{code}</p>}
          <h1 className="mt-3 font-display text-[2rem] sm:text-4xl lg:text-5xl">{title}</h1>
          <p className="mt-4 max-w-md leading-relaxed text-steel">{text}</p>
          <div className="mt-8 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3">
            {children}
          </div>
        </div>
      </Container>
    </div>
  );
}
