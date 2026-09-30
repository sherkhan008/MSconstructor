import type { ReactNode } from 'react';

/** Small inline storefront glyphs. Decorative only — every use sits next to
 * visible text that carries the meaning. */

export function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M3 9H15M10 4L15 9L10 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="mt-px shrink-0 text-foreground">
      <path d="M3.5 9.5L7 13L14.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

/** Benefit-row glyphs (homepage hero): 28px line drawings in the text colour. */
function BenefitGlyph({ children }: { children: ReactNode }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true" className="shrink-0" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/** A loaded shelf. */
export function LoadIcon() {
  return (
    <BenefitGlyph>
      <path d="M4 20.5H24M6 20.5V24M22 20.5V24" />
      <path d="M8 20.5V12.5H14.5V20.5M14.5 20.5V8.5H20.5V20.5" />
    </BenefitGlyph>
  );
}

/** Modules: a rack of two sections. */
export function ModulesIcon() {
  return (
    <BenefitGlyph>
      <path d="M5 4V24M14 4V24M23 4V24" />
      <path d="M5 9.5H23M5 15H23M5 20.5H23" />
    </BenefitGlyph>
  );
}

/** Delivery truck. */
export function TruckIcon() {
  return (
    <BenefitGlyph>
      <path d="M3 7.5H17V19H3Z" />
      <path d="M17 11H21.5L25 15V19H17" />
      <circle cx="8" cy="20.5" r="2" className="fill-surface" />
      <circle cx="20.5" cy="20.5" r="2" className="fill-surface" />
    </BenefitGlyph>
  );
}

/** A document with lines. */
export function DocumentIcon() {
  return (
    <BenefitGlyph>
      <path d="M7 3.5H17.5L22 8V24.5H7Z" />
      <path d="M17.5 3.5V8H22M10.5 13H18.5M10.5 17H18.5M10.5 21H15" />
    </BenefitGlyph>
  );
}
