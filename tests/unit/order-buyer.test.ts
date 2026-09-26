import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOrderBuyerSnapshot } from '@/lib/documents/snapshots';
import { orderBuyer, type CustomerRowFields } from '@/lib/orders/buyer';
import type { OrderRecord } from '@/lib/orders/types';

/**
 * Customer identity on public orders. The Customer row is shared by every
 * order from one phone number + customer type, so an order is shown with the
 * buyer it was placed by (its frozen snapshot), and a new order never
 * rewrites the shared row.
 */

const SHARED_ROW: CustomerRowFields = {
  fullName: 'Алия Первая',
  phone: '+77001112233',
  whatsapp: null,
  email: 'first@example.com',
  city: 'Астана',
  companyName: null,
  binIin: null,
  type: 'INDIVIDUAL',
};

describe('orderBuyer', () => {
  it("shows the order's own buyer snapshot, not the shared customer row", () => {
    const snapshot = createOrderBuyerSnapshot({
      type: 'INDIVIDUAL',
      fullName: 'Болат Второй',
      phone: '+77001112233',
      email: 'second@example.com',
      city: 'Алматы',
    });
    expect(orderBuyer(snapshot, SHARED_ROW)).toEqual({
      fullName: 'Болат Второй',
      phone: '+77001112233',
      whatsapp: undefined,
      email: 'second@example.com',
      city: 'Алматы',
      companyName: undefined,
      binIin: undefined,
      type: 'INDIVIDUAL',
    });
  });

  it('falls back to the customer row only for an order without a valid snapshot (placed before snapshots existed)', () => {
    const fromRow = {
      fullName: 'Алия Первая',
      phone: '+77001112233',
      whatsapp: undefined,
      email: 'first@example.com',
      city: 'Астана',
      companyName: undefined,
      binIin: undefined,
      type: 'INDIVIDUAL',
    };
    expect(orderBuyer(null, SHARED_ROW)).toEqual(fromRow);
    expect(orderBuyer({ version: 99, fullName: 'x' }, SHARED_ROW)).toEqual(fromRow);
  });
});

describe('saveOrderToDb', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/db/client');
    vi.resetModules();
  });

  it('writes customer, order, items and status history as ONE nested create that never updates an existing customer', async () => {
    vi.resetModules();
    const create = vi.fn(async () => ({}));
    const forbidden = vi.fn(() => {
      throw new Error('the shared customer row must not be written separately');
    });
    vi.doMock('@/lib/db/client', () => ({
      prisma: {
        order: { create },
        customer: { upsert: forbidden, update: forbidden, updateMany: forbidden, create: forbidden },
        $transaction: forbidden,
      },
    }));
    const { saveOrderToDb } = await import('@/lib/orders/db-store');

    const customer: OrderRecord['customer'] = { fullName: 'Болат Второй', phone: '+77001112233', email: 'second@example.com', city: 'Алматы', type: 'INDIVIDUAL' };
    await saveOrderToDb({
      id: 'o1',
      orderNumber: 'MS-20260926-AAAAA',
      status: 'NEW',
      customer,
      buyerSnapshot: createOrderBuyerSnapshot(customer),
      paymentPreference: 'BANK_TRANSFER',
      items: [],
      netTotal: 100,
      vatTotal: 16,
      discountTotal: 0,
      grandTotal: 116,
      createdAt: new Date().toISOString(),
    });

    expect(create).toHaveBeenCalledTimes(1);
    const { data } = (
      create.mock.calls[0] as unknown as [
        { data: { customer: { connectOrCreate: { where: unknown } }; customerId?: string; items: object; statusHistory: object; buyerSnapshot: object } },
      ]
    )[0];
    // Connect-or-create only: there is no update branch to overwrite anything.
    expect(Object.keys(data.customer)).toEqual(['connectOrCreate']);
    expect(data.customer.connectOrCreate.where).toEqual({ phone_type: { phone: '+77001112233', type: 'INDIVIDUAL' } });
    expect(data.customerId).toBeUndefined();
    // Items and the first status entry are nested in the same write.
    expect(data.items).toHaveProperty('create');
    expect(data.statusHistory).toHaveProperty('create');
    expect(data.buyerSnapshot).toMatchObject({ fullName: 'Болат Второй', email: 'second@example.com' });
    expect(forbidden).not.toHaveBeenCalled();
  });
});
