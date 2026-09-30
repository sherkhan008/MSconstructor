import { formatPrice } from '@/lib/money';

/** A price in the storefront's bold sans face. `.mono` is kept for its
 * tabular numerals (and as the stable hook tests read prices through); the
 * sans face overrides its font family. */
export function PriceTag({
  value,
  size = 'md',
  className = '',
}: {
  value: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const sizeClass = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-2xl',
    xl: 'text-3xl sm:text-4xl',
  }[size];

  return <span className={`mono font-sans font-bold tracking-tight text-foreground ${sizeClass} ${className}`}>{formatPrice(value)}</span>;
}
