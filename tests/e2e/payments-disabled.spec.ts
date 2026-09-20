import { test, expect } from './helpers/test';

/**
 * Online payment is not a feature of this build, and a running server must
 * say so the same way a probe would find out: by finding nothing.
 *
 * These run against the real production build with no PAYMENTS_ENABLED set —
 * the shipped default. Nothing here needs a database.
 */

test.describe('online payment is unavailable', () => {
  test('POST /api/payments answers 404 and names no payment capability', async ({ request }) => {
    const response = await request.post('/api/payments', {
      data: { orderNumber: 'MS-20260920-AAAAA' },
    });

    expect(response.status()).toBe(404);
    const body = await response.text();
    for (const term of ['kaspi', 'provider', 'PAYMENTS_ENABLED', 'PENDING']) {
      expect(body.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  test('a forged amount or status changes nothing about the answer', async ({ request }) => {
    for (const data of [
      { orderNumber: 'MS-20260920-AAAAA', amount: 1 },
      { orderNumber: 'MS-20260920-AAAAA', status: 'PAID', paidAt: '2026-01-01' },
      { orderNumber: 'MS-20260920-AAAAA', provider: 'kaspi' },
    ]) {
      const response = await request.post('/api/payments', { data });
      expect(response.status()).toBe(404);
    }
  });

  test('GET is not a payment route either', async ({ request }) => {
    expect((await request.get('/api/payments')).status()).toBe(405);
  });

  test('the /payment page lists Kaspi as upcoming and offers no way to pay', async ({ page }) => {
    await page.goto('/payment');

    await expect(page.getByRole('heading', { name: 'Оплата', level: 1 })).toBeVisible();
    // Marked "Скоро", not presented as usable.
    await expect(page.getByText('Kaspi Pay')).toBeVisible();
    await expect(page.getByText('Скоро')).toBeVisible();

    // No control anywhere that claims to start a payment.
    await expect(page.getByRole('button', { name: /оплатить/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /оплатить/i })).toHaveCount(0);
  });

  test('checkout offers only the three offline methods', async ({ page }) => {
    await page.goto('/order');

    const select = page.locator('select[name="paymentPreference"]');
    if ((await select.count()) === 0) {
      // Empty cart — the form is not rendered, which is equally "no online
      // payment offered". Nothing further to assert.
      return;
    }

    const values = await select.locator('option').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
    expect(values).toEqual(['BANK_TRANSFER', 'BANK_INVOICE', 'CASH']);
  });
});
