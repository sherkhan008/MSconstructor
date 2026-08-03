'use client';

import { publicEnv } from '@/lib/env';

/**
 * Centralized analytics helper. Every trackable interaction in the app must
 * call `trackEvent` from here rather than reaching into gtag/ym directly —
 * that keeps provider wiring in one place and means a missing analytics ID
 * (the default in local development) silently no-ops instead of throwing.
 */

export type AnalyticsEvent =
  | 'configurator_opened'
  | 'model_selected'
  | 'step_completed'
  | 'configuration_completed'
  | 'configuration_saved'
  | 'configuration_shared'
  | 'product_added_to_cart'
  | 'order_submitted'
  | 'quote_requested'
  | 'whatsapp_clicked'
  | 'phone_clicked'
  | 'email_clicked'
  | 'pdf_downloaded'
  | 'payment_method_selected'
  | 'order_completed';

export type AnalyticsProps = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    ym?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export function trackEvent(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  if (typeof window === 'undefined') return;

  if (process.env.NODE_ENV === 'development') {
     
    console.info('[analytics]', event, props);
  }

  if (publicEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID && typeof window.gtag === 'function') {
    window.gtag('event', event, props);
  }

  if (publicEnv.NEXT_PUBLIC_YANDEX_METRICA_ID && typeof window.ym === 'function') {
    const counterId = Number(publicEnv.NEXT_PUBLIC_YANDEX_METRICA_ID);
    window.ym(counterId, 'reachGoal', event, props);
  }
}
