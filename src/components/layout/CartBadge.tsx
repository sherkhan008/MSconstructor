'use client';

import { useEffect, useState } from 'react';
import { useCartStore } from '@/store/cart-store';

/**
 * Renders the cart item count. Cart state is persisted to localStorage and
 * therefore unknown during server rendering — mounting a client-only counter
 * avoids a hydration mismatch instead of guessing at the server value.
 */
export function CartBadge() {
  const [mounted, setMounted] = useState(false);
  const count = useCartStore((state) => state.items.length);

  useEffect(() => setMounted(true), []);

  if (!mounted || count === 0) return null;

  return (
    <span className="mono absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-foreground">
      {count}
    </span>
  );
}
