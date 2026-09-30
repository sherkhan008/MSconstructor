import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { NotificationChannel, ChannelSendResult } from '@/lib/notifications/channels';
import type { OrderRecord } from '@/lib/orders/types';

/**
 * Business record + notification outbox atomicity against the REAL
 * PostgreSQL database (runs only when DATABASE_URL is set):
 *
 *  - a new ContactLead and its PENDING outbox rows commit together, and a
 *    forced outbox failure rolls the lead back;
 *  - a new Order (customer, items, history) and its outbox row commit
 *    together, and a forced outbox failure rolls the order back;
 *  - a provider failure AFTER commit never removes the order / lead;
 *  - a deduplicated lead writes no second outbox row;
 *  - a committed row that was never dispatched (crash right after commit) is
 *    due for the worker once its lease runs out.
 *
 * Channels are fakes (no network). Fixture rows use the reserved +7903…
 * phone range and are deleted by phone / order number afterwards. The global
 * worker pass is not run here (it would touch unrelated rows on a shared DB).
 */

describe.skipIf(!process.env.DATABASE_URL)('outbox atomicity (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let leads: typeof import('@/lib/contact-leads/store');
  let orders: typeof import('@/lib/orders/store');
  let service: typeof import('@/lib/notifications/service');
  let events: typeof import('@/lib/notifications/events');
  let outboxStore: typeof import('@/lib/notifications/store');

  const phones: string[] = [];
  const orderNumbers: string[] = [];
  const newPhone = () => {
    const phone = `+7903${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    phones.push(phone);
    return phone;
  };

  function fake(id: string, results: ChannelSendResult[] = []): NotificationChannel & { sent: number } {
    const channel = {
      id,
      sent: 0,
      oncePerSubject: id === 'whatsapp',
      availability: () => ({ ok: true as const }),
      send: async () => {
        channel.sent += 1;
        return results.shift() ?? { ok: true as const };
      },
    };
    return channel;
  }

  function order(phone: string): OrderRecord {
    const orderNumber = orders.generateOrderNumber();
    orderNumbers.push(orderNumber);
    return {
      id: crypto.randomUUID(),
      orderNumber,
      status: 'NEW',
      customer: { fullName: 'ITEST Атомарность', phone, city: 'Астана', type: 'INDIVIDUAL' },
      paymentPreference: 'BANK_TRANSFER',
      items: [
        {
          configuration: { modelSlug: 'ms-standard', quantity: 1 } as OrderRecord['items'][number]['configuration'],
          bom: [],
          breakdown: { unitNet: 50_000, net: 50_000 } as OrderRecord['items'][number]['breakdown'],
          modelName: 'MS Стандарт',
        },
      ],
      netTotal: 50_000,
      vatTotal: 6_000,
      discountTotal: 0,
      grandTotal: 56_000,
      createdAt: new Date().toISOString(),
    };
  }

  const orderEvent = (o: OrderRecord) =>
    events.buildOrderEvent({ event: 'order.created', orderNumber: o.orderNumber, status: o.status, grandTotal: o.grandTotal });

  /** Rows whose second entry reuses the first one's primary key: the outbox
   * write fails inside the business transaction. */
  const collidingRows = <T extends { id: string }>(rows: T[]): T[] => [rows[0], { ...rows[0] }];

  beforeAll(async () => {
    ({ prisma } = await import('@/lib/db/client'));
    leads = await import('@/lib/contact-leads/store');
    orders = await import('@/lib/orders/store');
    service = await import('@/lib/notifications/service');
    events = await import('@/lib/notifications/events');
    outboxStore = await import('@/lib/notifications/store');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    const leadIds = (await prisma.contactLead.findMany({ where: { phone: { in: phones } }, select: { id: true } })).map((l) => l.id);
    await prisma.notificationDelivery.deleteMany({
      where: { OR: [{ contactLeadId: { in: leadIds } }, { orderNumber: { in: orderNumbers } }] },
    });
    await prisma.contactLead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.order.deleteMany({ where: { orderNumber: { in: orderNumbers } } });
    await prisma.customer.deleteMany({ where: { phone: { in: phones } } });
  });

  it('ContactLead + its outbox rows (one per available channel) commit together, before any send', async () => {
    const whatsapp = fake('whatsapp');
    const telegram = fake('telegram');
    const outbox = service.createOutbox('contact.created', { channels: () => [whatsapp, telegram] });
    const phone = newPhone();
    const { lead, duplicate } = await leads.saveContactLead({ name: 'ITEST Лид', phone, message: 'Атомарно', locale: 'ru' }, new Date(), {
      outbox: (l) => outbox.rowsFor(events.buildContactLeadEvent(l.id)),
    });
    expect(duplicate).toBe(false);

    const rows = await prisma.notificationDelivery.findMany({ where: { contactLeadId: lead.id }, orderBy: { channel: 'asc' } });
    expect(rows.map((r) => [r.channel, r.status, r.attempts, r.orderNumber])).toEqual([
      ['telegram', 'PENDING', 0, null],
      ['whatsapp', 'PENDING', 0, null],
    ]);
    expect(rows.every((r) => r.nextAttemptAt !== null && r.nextAttemptAt > new Date())).toBe(true);
    expect(whatsapp.sent + telegram.sent).toBe(0);

    await outbox.dispatch();
    expect(await prisma.notificationDelivery.findMany({ where: { contactLeadId: lead.id }, select: { status: true, attempts: true } })).toEqual([
      { status: 'SENT', attempts: 1 },
      { status: 'SENT', attempts: 1 },
    ]);
  });

  it('forced outbox failure rolls the ContactLead back: no lead, no rows, the caller gets the error', async () => {
    const outbox = service.createOutbox('contact.created', { channels: () => [fake('whatsapp')] });
    const phone = newPhone();
    const attempted: { id: string; subject: unknown }[] = [];
    await expect(
      leads.saveContactLead({ name: 'ITEST Откат', phone, message: 'Должно откатиться', locale: 'ru' }, new Date(), {
        outbox: (l) => {
          const rows = collidingRows(outbox.rowsFor(events.buildContactLeadEvent(l.id)));
          attempted.push(...rows);
          return rows;
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(attempted).toHaveLength(2);
    expect(await prisma.contactLead.count({ where: { phone } })).toBe(0);
    expect(await prisma.notificationDelivery.count({ where: { id: { in: attempted.map((r) => r.id) } } })).toBe(0);
  });

  it('a deduplicated submission writes no second outbox row and sends nothing again', async () => {
    const whatsapp = fake('whatsapp');
    const phone = newPhone();
    const input = { name: 'ITEST Повтор', phone, message: 'Одно и то же', locale: 'ru' as const };
    const first = service.createOutbox('contact.created', { channels: () => [whatsapp] });
    const a = await leads.saveContactLead(input, new Date(), { outbox: (l) => first.rowsFor(events.buildContactLeadEvent(l.id)) });
    await first.dispatch();

    const second = service.createOutbox('contact.created', { channels: () => [whatsapp] });
    const rowsFor = vi.fn((l: { id: string }) => second.rowsFor(events.buildContactLeadEvent(l.id)));
    const b = await leads.saveContactLead(input, new Date(), { outbox: rowsFor });
    expect(b).toMatchObject({ duplicate: true, lead: { id: a.lead.id } });
    expect(rowsFor).not.toHaveBeenCalled();
    await second.dispatch();

    expect(await prisma.contactLead.count({ where: { phone } })).toBe(1);
    expect(await prisma.notificationDelivery.count({ where: { contactLeadId: a.lead.id } })).toBe(1);
    expect(whatsapp.sent).toBe(1);
  });

  it('Order (customer, items, history) + its outbox row commit together, before any send', async () => {
    const whatsapp = fake('whatsapp');
    const outbox = service.createOutbox('order.created', { channels: () => [whatsapp] });
    const phone = newPhone();
    const saved = await orders.saveOrder(order(phone), { outbox: (o) => outbox.rowsFor(orderEvent(o)) });

    const stored = await prisma.order.findUnique({ where: { orderNumber: saved.orderNumber }, include: { items: true, statusHistory: true } });
    expect(stored).not.toBeNull();
    expect(stored!.items).toHaveLength(1);
    expect(stored!.statusHistory).toHaveLength(1);
    const rows = await prisma.notificationDelivery.findMany({ where: { orderNumber: saved.orderNumber } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: 'order.created', channel: 'whatsapp', status: 'PENDING', attempts: 0, contactLeadId: null });
    expect(whatsapp.sent).toBe(0);

    await outbox.dispatch();
    expect(await prisma.notificationDelivery.findUnique({ where: { id: rows[0].id } })).toMatchObject({ status: 'SENT', attempts: 1 });
  });

  it('forced outbox failure rolls the new order back: no order, no customer, no rows', async () => {
    const outbox = service.createOutbox('order.created', { channels: () => [fake('whatsapp')] });
    const phone = newPhone();
    const draft = order(phone);
    await expect(orders.saveOrder(draft, { outbox: (o) => collidingRows(outbox.rowsFor(orderEvent(o))) })).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(await prisma.order.count({ where: { orderNumber: draft.orderNumber } })).toBe(0);
    expect(await prisma.customer.count({ where: { phone } })).toBe(0);
    expect(await prisma.notificationDelivery.count({ where: { orderNumber: draft.orderNumber } })).toBe(0);
  });

  it('a provider failure after commit keeps the order and the lead; rows become retryable FAILED', async () => {
    const failing = () => fake('whatsapp', [{ ok: false, error: 'HTTP_503_META_131016' }]);

    const orderOutbox = service.createOutbox('order.created', { channels: () => [failing()] });
    const saved = await orders.saveOrder(order(newPhone()), { outbox: (o) => orderOutbox.rowsFor(orderEvent(o)) });
    await orderOutbox.dispatch();
    const storedOrder = await prisma.order.findUnique({ where: { orderNumber: saved.orderNumber } });
    expect(Number(storedOrder!.grandTotal)).toBe(56_000);
    const [orderRow] = await prisma.notificationDelivery.findMany({ where: { orderNumber: saved.orderNumber } });
    expect(orderRow).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'HTTP_503_META_131016' });
    expect(orderRow.nextAttemptAt).not.toBeNull();

    const leadOutbox = service.createOutbox('contact.created', { channels: () => [failing()] });
    const { lead } = await leads.saveContactLead({ name: 'ITEST Сбой Meta', phone: newPhone(), message: 'Meta упала', locale: 'ru' }, new Date(), {
      outbox: (l) => leadOutbox.rowsFor(events.buildContactLeadEvent(l.id)),
    });
    await leadOutbox.dispatch();
    expect(await prisma.contactLead.findUnique({ where: { id: lead.id } })).not.toBeNull();
    const [leadRow] = await prisma.notificationDelivery.findMany({ where: { contactLeadId: lead.id } });
    expect(leadRow).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(leadRow.nextAttemptAt).not.toBeNull();
  });

  it('a crash right after commit (never dispatched) leaves a row the worker picks up after the lease', async () => {
    const outbox = service.createOutbox('order.created', { channels: () => [fake('whatsapp')] });
    const saved = await orders.saveOrder(order(newPhone()), { outbox: (o) => outbox.rowsFor(orderEvent(o)) });
    // No dispatch: the process "died" here.
    const [row] = await prisma.notificationDelivery.findMany({ where: { orderNumber: saved.orderNumber } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 0 });
    const lease = row.nextAttemptAt!;
    expect((await outboxStore.listDueDeliveries(new Date(lease.getTime() - 1), 1000)).some((r) => r.id === row.id)).toBe(false);
    const due = (await outboxStore.listDueDeliveries(lease, 1000)).find((r) => r.id === row.id);
    expect(due).toMatchObject({ status: 'PENDING', orderNumber: saved.orderNumber });
    expect(await outboxStore.claimDelivery(row.id, lease, new Date(lease.getTime() + 60_000))).toBe(true);
  });
});
