'use client';

/**
 * The query string the language switcher carries to the other-language page.
 *
 * By default that is the current URL's query (then allow-listed by
 * safeSwitchQuery). A page whose live state is newer than its URL registers
 * a provider instead: the configurator never writes edits back to the URL,
 * so its original share-link query would re-apply a stale configuration over
 * the customer's changes — it provides its CURRENT configuration, serialized
 * in the same share-link format, instead.
 */
let provider: (() => string) | null = null;

/** Registers the page's query provider; returns the unregister function. */
export function registerSwitchQuery(next: () => string): () => void {
  provider = next;
  return () => {
    if (provider === next) provider = null;
  };
}

/** `?…` to carry across a language switch right now. */
export function currentSwitchSearch(): string {
  return provider ? provider() : window.location.search;
}
