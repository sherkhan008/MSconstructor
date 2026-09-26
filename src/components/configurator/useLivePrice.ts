'use client';

import { useEffect, useRef } from 'react';
import { useConfiguratorStore } from '@/store/configurator-store';
import { t } from '@/lib/i18n/format';
import { apiHeaders } from '@/lib/i18n/request';
import { ER } from '@/lib/i18n/strings';
import { useLocale } from '@/components/i18n/LocaleProvider';

const DEBOUNCE_MS = 300;

interface KitRequest {
  /** The configuration JSON last scheduled for this kit. */
  json: string;
  timer: ReturnType<typeof setTimeout> | null;
  controller: AbortController | null;
}

/**
 * Debounced live price updates for every kit in the workspace. Each kit is
 * priced by the server-side pricing API (src/app/api/pricing/calculate) on
 * its own, and ONLY when its own configuration changed since it was last
 * requested — switching the active kit, switching the preview mode or
 * editing another kit never re-prices it. The price shown is never computed
 * in the browser; each answer is stored with the exact configuration it
 * answers (KitPriceState.pricedJson), so a result is never mistaken for the
 * price of a newer configuration.
 *
 * The request declares the page locale (apiHeaders) so the server answers
 * pricing errors in the customer's language. The locale is fixed for the
 * lifetime of a page (a language switch is a full navigation), so it never
 * triggers a re-price by itself.
 */
export function useLivePrice(): void {
  const kits = useConfiguratorStore((s) => s.kits);
  const retryNonce = useConfiguratorStore((s) => s.pricingRetryNonce);
  const requests = useRef(new Map<string, KitRequest>());
  const lastRetryNonce = useRef(retryNonce);
  const locale = useLocale();

  useEffect(() => {
    const { setKitPricing } = useConfiguratorStore.getState();
    const retrying = retryNonce !== lastRetryNonce.current;
    lastRetryNonce.current = retryNonce;
    const live = new Set(kits.map((k) => k.id));

    for (const [id, request] of requests.current) {
      if (live.has(id)) continue;
      if (request.timer) clearTimeout(request.timer);
      request.controller?.abort();
      requests.current.delete(id);
    }

    for (const kit of kits) {
      const json = JSON.stringify(kit.configuration);
      const previous = requests.current.get(kit.id);
      const price = useConfiguratorStore.getState().kitPrices[kit.id];
      // A retry re-asks only for kits without a current answer.
      const needsRetry = retrying && !price?.result;
      if (previous && previous.json === json && !needsRetry) continue;

      if (previous?.timer) clearTimeout(previous.timer);
      const request: KitRequest = { json, timer: null, controller: previous?.controller ?? null };
      requests.current.set(kit.id, request);
      request.timer = setTimeout(() => {
        request.timer = null;
        request.controller?.abort();
        const controller = new AbortController();
        request.controller = controller;
        setKitPricing(kit.id, { isPricing: true });

        fetch('/api/pricing/calculate', {
          method: 'POST',
          headers: apiHeaders(locale),
          body: json,
          signal: controller.signal,
        })
          .then(async (response) => {
            const data = await response.json();
            if (data.ok) {
              setKitPricing(kit.id, { result: data, error: null, pricedJson: json, isPricing: false });
            } else {
              setKitPricing(kit.id, { result: null, error: data, pricedJson: json, isPricing: false });
            }
          })
          .catch((error: unknown) => {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            setKitPricing(kit.id, {
              result: null,
              error: { ok: false, code: 'VALIDATION_ERROR', message: t(ER['ER-014'], locale) },
              pricedJson: json,
              isPricing: false,
            });
          });
      }, DEBOUNCE_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kits, retryNonce]);

  useEffect(() => {
    const pending = requests.current;
    return () => {
      for (const request of pending.values()) {
        if (request.timer) clearTimeout(request.timer);
        request.controller?.abort();
      }
      pending.clear();
    };
  }, []);
}
