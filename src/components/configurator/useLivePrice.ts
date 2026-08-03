'use client';

import { useEffect, useRef } from 'react';
import { useConfiguratorStore } from '@/store/configurator-store';
import type { ShelvingConfiguration } from '@/lib/types/domain';

const DEBOUNCE_MS = 300;

/**
 * Debounced live price updates. Every change to the configuration re-calls
 * the server-side pricing API (src/app/api/pricing/calculate) — the price
 * shown here is never computed in the browser.
 */
export function useLivePrice(config: ShelvingConfiguration): void {
  const setPriceResult = useConfiguratorStore((s) => s.setPriceResult);
  const setPricingError = useConfiguratorStore((s) => s.setPricingError);
  const setIsPricing = useConfiguratorStore((s) => s.setIsPricing);
  const configJson = JSON.stringify(config);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsPricing(true);

      fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: configJson,
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = await response.json();
          if (data.ok) {
            setPriceResult(data);
          } else {
            setPricingError(data);
          }
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setPricingError({ ok: false, code: 'VALIDATION_ERROR', message: 'Не удалось рассчитать цену. Проверьте соединение.' });
        })
        .finally(() => setIsPricing(false));
       
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configJson]);
}
