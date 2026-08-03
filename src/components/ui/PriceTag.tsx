import { formatPrice } from '@/lib/money';

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

  return <span className={`mono font-semibold text-foreground ${sizeClass} ${className}`}>{formatPrice(value)}</span>;
}
