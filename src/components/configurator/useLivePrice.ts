'use client';

import { useEffect, useRef } from 'react';
import { useConfiguratorStore } from '@/store/configurator-store';
import type { ShelvingConfiguration } from '@/lib/types/domain';
import { t } from '@/lib/i18n/format';
import { apiHeaders } from '@/lib/i18n/request';
import { ER } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

const DEBOUNCE_MS = 300;

/**
 * Debounced live price updates. Every change to the configuration re-calls
 * the server-side pricing API (src/app/api/pricing/calculate) — the price
 * shown here is never computed in the browser.
 *
 * The request declares the page locale (apiHeaders) so the server answers
 * pricing errors in the customer's language. The locale is fixed for the
 * lifetime of a page (a language switch is a full navigation), so it never
 * triggers a re-price by itself.
 */
export function useLivePrice(config: ShelvingConfiguration): void {
  const setPriceResult = useConfiguratorStore((s) => s.setPriceResult);
  const setPricingError = useConfiguratorStore((s) => s.setPricingError);
  const setIsPricing = useConfiguratorStore((s) => s.setIsPricing);
  const retryNonce = useConfiguratorStore((s) => s.pricingRetryNonce);
  const configJson = JSON.stringify(config);
  const abortRef = useRef<AbortController | null>(null);
  const locale = useLocale();

  useEffect(() => {
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsPricing(true);

      fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: apiHeaders(locale),
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
          setPricingError({ ok: false, code: 'VALIDATION_ERROR', message: t(ER['ER-014'], locale) });
        })
        .finally(() => setIsPricing(false));
       
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configJson, retryNonce]);
}
