import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'whatsapp';
type Size = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-foreground text-background hover:bg-blueprint border border-foreground hover:border-blueprint',
  secondary: 'bg-accent text-foreground hover:bg-accent/90 border border-accent',
  outline: 'bg-transparent text-foreground border border-line hover:border-foreground',
  ghost: 'bg-transparent text-foreground hover:bg-surface-muted border border-transparent',
  whatsapp: 'bg-success text-white hover:bg-success/90 border border-success',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3.5 text-base',
};

const base =
  'inline-flex items-center justify-center gap-2 font-medium tracking-wide transition-colors duration-150 rounded-[3px] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap';

/** The same button look for elements that cannot be <Button>/<LinkButton> —
 * e.g. a plain <a> to a file download, where client-side routing must not
 * intercept the navigation. */
export function buttonClassName(variant: Variant = 'primary', size: Size = 'md'): string {
  return `${base} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]}`;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; children: ReactNode }) {
  return (
    <button className={`${base} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function LinkButton({
  children,
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  target,
  rel,
  onClick,
}: {
  children: ReactNode;
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  target?: string;
  rel?: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      target={target}
      rel={rel}
      onClick={onClick}
      className={`${base} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
    >
      {children}
    </Link>
  );
}
