'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { PublicCatalog } from '@/lib/data/public-catalog';
import { ConfiguratorClient } from './ConfiguratorClient';

/**
 * Mounts the configurator on the client only, showing `fallback` in the
 * server HTML. The configurator renders from localStorage-persisted state
 * that the server cannot know, so server-rendered configurator markup never
 * hydrates cleanly — React discards and re-mounts the whole subtree, and a
 * drag started in between is lost. While /configurator was prerendered at
 * build time, useSearchParams() gave this same client-only rendering
 * implicitly; now that the page renders per request (it reads the runtime
 * catalog), it has to be explicit. Same mounted-gate idiom as CartBadge.
 */
export function ClientOnlyConfigurator({ catalog, fallback }: { catalog: PublicCatalog; fallback: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return mounted ? <ConfiguratorClient catalog={catalog} /> : fallback;
}
