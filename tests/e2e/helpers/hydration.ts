import { expect, type Locator } from '@playwright/test';

/**
 * Clicks a control that server-side rendering already leaves enabled.
 *
 * Playwright's actionability checks answer "is this element attached, visible,
 * stable, and enabled" — and all four are true of the SSR HTML, before React
 * has hydrated and attached a single event listener. A click that lands in
 * that window is *silently dropped*: React does not replay events that
 * happened before `hydrateRoot()` ran, so `onClick` never fires, no request
 * is sent, and the page simply keeps showing what the server rendered. There
 * is no error anywhere — the click just did nothing.
 *
 * The window is a few dozen milliseconds on an idle machine, which is why a
 * focused run of such a test passes hundreds of times in a row, and why it
 * fails in a full run, where two browser projects and the server under test
 * compete for the same CPU and hydration slips past the click.
 *
 * Every other admin form is immune by accident: its submit button starts out
 * `disabled` (nothing has changed yet), so it can only become enabled after
 * React has processed an onChange — which means Playwright's own "wait for
 * enabled" is already waiting for hydration. This helper gives the same
 * guarantee to a button that has no such state, e.g. "Взять заказ".
 *
 * The signal is React's own bookkeeping: it writes a `__reactProps$<id>`
 * property onto each DOM node whose props it owns. Its presence on *this*
 * node means this node's `onClick` is live — a stronger statement than
 * "hydration has started somewhere in the tree".
 */
export async function clickWhenHydrated(locator: Locator): Promise<void> {
  await waitForHydration(locator);
  await locator.click();
}

/**
 * Waits until React owns this element, without touching it.
 *
 * The same guarantee `clickWhenHydrated` needs is needed by *filling* a
 * controlled input: `fill()` sets the DOM value and dispatches an `input`
 * event, and if that happens before hydration nobody is listening. React then
 * hydrates with its initial state (`''`) while the DOM keeps showing the typed
 * text, so the form submits empty fields and the page reports bad credentials
 * — again with no error anywhere. That is exactly the shape of
 * src/components/admin/LoginForm.tsx, whose inputs are controlled and whose
 * submit is JavaScript-only.
 */
export async function waitForHydration(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const element = await locator.elementHandle();
  try {
    await locator
      .page()
      .waitForFunction(
        (node) => Object.keys(node as object).some((key) => key.startsWith('__reactProps$')),
        element,
        { timeout: 15_000 },
      );
  } finally {
    await element?.dispose();
  }
}
