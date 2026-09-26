import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createOrderBuyerSnapshot } from '@/lib/documents/snapshots';
import type { OrderRecord } from '@/lib/orders/types';

/**
 * Order + customer persistence against the REAL PostgreSQL database
 * (runs only when DATABASE_URL is set):
 *
 *  - a second order from the same phone never rewrites the first buyer's
 *    name/email on the shared Customer row, and each order keeps showing its
 *    own buyer (admin list and order lookup alike);
 *  - customer + order + items + status history are one atomic write: a failed
 *    order leaves no Customer row behind;
 *  - two simultaneous first orders from one phone both succeed and share one
 *    Customer row;
 *  - totals written with an order stay as written.
 *
 * Fixture rows use the reserved +7908… phone range and are deleted by exact
 * order number / phone afterwards; nothing else is touched.
 */

describe.skipIf(!process.env.DATABASE_URL)('order customer identity (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let saveOrderToDb: (order: OrderRecord) => Promise<OrderRecord>;
  let getOrderByNumberFromDb: (orderNumber: string) => Promise<OrderRecord | undefined>;
  let saveOrder: (order: OrderRecord) => Promise<OrderRecord>;
  let generateOrderNumber: () => string;
  let listOrders: typeof import('@/lib/admin/orders').listOrders;

  const phones: string[] = [];
  const orderNumbers: string[] = [];
  const newPhone = () => {
    const phone = `+7908${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    phones.push(phone);
    return phone;
  };

  function order(customer: OrderRecord['customer'], grandTotal: number): OrderRecord {
    const orderNumber = generateOrderNumber();
    orderNumbers.push(orderNumber);
    return {
      id: crypto.randomUUID(),
      orderNumber,
      status: 'NEW',
      customer,
      buyerSnapshot: createOrderBuyerSnapshot(customer),
      paymentPreference: 'BANK_TRANSFER',
      items: [
        {
          configuration: { modelSlug: 'ms-standard', quantity: 1 } as OrderRecord['items'][number]['configuration'],
          bom: [],
          breakdown: { unitNet: grandTotal - 16, net: grandTotal - 16 } as OrderRecord['items'][number]['breakdown'],
          modelName: 'MS Стандарт',
        },
      ],
      netTotal: grandTotal - 16,
      vatTotal: 16,
      discountTotal: 0,
      grandTotal,
      createdAt: new Date().toISOString(),
    };
  }

  beforeAll(async () => {
    ({ prisma } = await import('@/lib/db/client'));
    ({ saveOrderToDb, getOrderByNumberFromDb } = await import('@/lib/orders/db-store'));
    ({ saveOrder, generateOrderNumber } = await import('@/lib/orders/store'));
    ({ listOrders } = await import('@/lib/admin/orders'));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.order.deleteMany({ where: { orderNumber: { in: orderNumbers } } });
    await prisma.customer.deleteMany({ where: { phone: { in: phones } } });
  });

  it("a later order from the same phone does not overwrite the first buyer's identity", async () => {
    const phone = newPhone();
    const first = await saveOrderToDb(order({ fullName: 'ITEST Алия', phone, email: 'aliya@itest.invalid', city: 'Астана', type: 'INDIVIDUAL' }, 100_016));
    const second = await saveOrderToDb(order({ fullName: 'ITEST Болат', phone, email: 'bolat@itest.invalid', city: 'Алматы', type: 'INDIVIDUAL' }, 200_016));

    const rows = await prisma.customer.findMany({ where: { phone } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fullName: 'ITEST Алия', email: 'aliya@itest.invalid', city: 'Астана' });

    // Each order still shows the buyer who placed it, and its own totals.
    const a = await getOrderByNumberFromDb(first.orderNumber);
    const b = await getOrderByNumberFromDb(second.orderNumber);
    expect(a?.customer).toMatchObject({ fullName: 'ITEST Алия', email: 'aliya@itest.invalid', city: 'Астана' });
    expect(b?.customer).toMatchObject({ fullName: 'ITEST Болат', email: 'bolat@itest.invalid', city: 'Алматы' });
    expect(a?.grandTotal).toBe(100_016);
    expect(b?.grandTotal).toBe(200_016);

    // The admin list shows each order's own buyer too.
    const listed = await listOrders({ search: phone.slice(2) });
    const names = Object.fromEntries(listed.orders.map((o) => [o.orderNumber, o.customerName]));
    expect(names[first.orderNumber]).toBe('ITEST Алия');
    expect(names[second.orderNumber]).toBe('ITEST Болат');
  });

  it('a failed order write leaves no customer row behind (one atomic write)', async () => {
    const taken = await saveOrderToDb(order({ fullName: 'ITEST Первый', phone: newPhone(), city: 'Астана', type: 'INDIVIDUAL' }, 50_016));
    const phone = newPhone();
    const clash = { ...order({ fullName: 'ITEST Откат', phone, city: 'Астана', type: 'INDIVIDUAL' }, 60_016), orderNumber: taken.orderNumber };

    await expect(saveOrderToDb(clash)).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.customer.count({ where: { phone } })).toBe(0);
  });

  it('two simultaneous first orders from one phone both succeed and share one customer row', async () => {
    const phone = newPhone();
    const results = await Promise.all(
      ['ITEST Одновременно 1', 'ITEST Одновременно 2', 'ITEST Одновременно 3'].map((fullName, i) =>
        saveOrder(order({ fullName, phone, city: 'Астана', type: 'INDIVIDUAL' }, 70_016 + i)),
      ),
    );
    orderNumbers.push(...results.map((r) => r.orderNumber));

    expect(await prisma.customer.count({ where: { phone } })).toBe(1);
    const stored = await prisma.order.findMany({ where: { orderNumber: { in: results.map((r) => r.orderNumber) } }, include: { items: true, statusHistory: true } });
    expect(stored).toHaveLength(3);
    for (const row of stored) {
      expect(row.items).toHaveLength(1);
      expect(row.statusHistory).toHaveLength(1);
    }
  });
});
