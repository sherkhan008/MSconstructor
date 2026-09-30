import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { OrderRecord } from '@/lib/orders/types';

/**
 * Contact leads + the notification outbox against the REAL PostgreSQL
 * database (runs only when DATABASE_URL is set):
 *
 *  - a lead is stored and read back; identical concurrent submissions create
 *    exactly one row (transaction-scoped advisory lock);
 *  - contact.created and order.created deliveries land in NotificationDelivery
 *    with the right subject column, PENDING → SENT/FAILED, redacted payload;
 *  - a WhatsApp failure never touches the saved order or its totals;
 *  - a PENDING row left by a crashed sender is due after its lease and can be
 *    claimed by exactly one worker;
 *  - the admin list shows the lead with its alert state.
 *
 * Meta is mocked at the HTTP boundary. Fixture rows use the reserved +7908…
 * phone range and are deleted by exact id / order number / phone afterwards.
 * The global worker pass (retryFailedDeliveries) is deliberately NOT run here:
 * on a shared database it would also pick up unrelated due rows.
 */

describe.skipIf(!process.env.DATABASE_URL)('contact leads + notification outbox (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let store: typeof import('@/lib/contact-leads/store');
  let outbox: typeof import('@/lib/notifications/store');
  let service: typeof import('@/lib/notifications/service');
  let events: typeof import('@/lib/notifications/events');
  let whatsapp: typeof import('@/lib/notifications/providers/whatsapp');
  let config: typeof import('@/lib/notifications/providers/whatsapp-config');
  let orders: typeof import('@/lib/orders/store');
  let admin: typeof import('@/lib/admin/contact-leads');

  const leadIds: string[] = [];
  const phones: string[] = [];
  const orderNumbers: string[] = [];
  const newPhone = () => {
    const phone = `+7908${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    phones.push(phone);
    return phone;
  };

  const ready = () =>
    config.resolveWhatsAppConfig({
      WHATSAPP_NOTIFICATIONS_ENABLED: 'true',
      WHATSAPP_ACCESS_TOKEN: 'EAAG-ITEST-TOKEN',
      WHATSAPP_PHONE_NUMBER_ID: '100000000000001',
      WHATSAPP_ADMIN_RECIPIENT: '+7 701 000 00 01',
      WHATSAPP_TEMPLATE_NAME: 'new_order_notification',
      WHATSAPP_CONTACT_TEMPLATE_NAME: 'new_contact_lead',
      WHATSAPP_TEMPLATE_LANGUAGE: 'ru',
    });

  beforeAll(async () => {
    ({ prisma } = await import('@/lib/db/client'));
    store = await import('@/lib/contact-leads/store');
    outbox = await import('@/lib/notifications/store');
    service = await import('@/lib/notifications/service');
    events = await import('@/lib/notifications/events');
    whatsapp = await import('@/lib/notifications/providers/whatsapp');
    config = await import('@/lib/notifications/providers/whatsapp-config');
    orders = await import('@/lib/orders/store');
    admin = await import('@/lib/admin/contact-leads');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    // By phone as well as by recorded id: a test that fails mid-way may have
    // stored a lead whose id it never got back.
    const byPhone = await prisma.contactLead.findMany({ where: { phone: { in: phones } }, select: { id: true } });
    const ids = [...new Set([...leadIds, ...byPhone.map((l) => l.id)])];
    await prisma.notificationDelivery.deleteMany({
      where: { OR: [{ contactLeadId: { in: ids } }, { orderNumber: { in: orderNumbers } }] },
    });
    await prisma.contactLead.deleteMany({ where: { id: { in: ids } } });
    await prisma.order.deleteMany({ where: { orderNumber: { in: orderNumbers } } });
    await prisma.customer.deleteMany({ where: { phone: { in: phones } } });
  });

  it('stores a lead and reads it back', async () => {
    const phone = newPhone();
    const { lead, duplicate } = await store.saveContactLead({ name: 'ITEST Лид', phone, message: 'Строка 1\nСтрока 2', locale: 'kk' });
    leadIds.push(lead.id);
    expect(duplicate).toBe(false);
    const row = await prisma.contactLead.findUnique({ where: { id: lead.id } });
    expect(row).toMatchObject({ name: 'ITEST Лид', phone, message: 'Строка 1\nСтрока 2', locale: 'kk' });
    expect(await store.getContactLeadById(lead.id)).toMatchObject({ id: lead.id, locale: 'kk' });
  });

  it('identical concurrent submissions create exactly one row', async () => {
    const phone = newPhone();
    const input = { name: 'ITEST Дубль', phone, message: 'Одно и то же', locale: 'ru' as const };
    const results = await Promise.all(Array.from({ length: 6 }, () => store.saveContactLead(input)));
    leadIds.push(...new Set(results.map((r) => r.lead.id)));
    expect(await prisma.contactLead.count({ where: { phone } })).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.lead.id)).size).toBe(1);
  });

  it('contact.created → WhatsApp: SENT row keyed by the lead, payload redacted, template from the stored lead', async () => {
    const phone = newPhone();
    const { lead } = await store.saveContactLead({ name: 'ITEST Уведомление', phone, message: 'Позвоните мне', locale: 'ru' });
    leadIds.push(lead.id);
    const bodies: { template: { name: string; components: { parameters: { text: string }[] }[] }; to: string }[] = [];
    const channel = whatsapp.createWhatsAppChannel({
      config: ready(),
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return { ok: true, status: 200 };
      },
    });
    await service.emitContactLeadEvent(events.buildContactLeadEvent(lead.id), { channels: () => [channel] });

    const rows = await prisma.notificationDelivery.findMany({ where: { contactLeadId: lead.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: 'contact.created', channel: 'whatsapp', status: 'SENT', attempts: 1, orderNumber: null, nextAttemptAt: null });
    expect(Object.keys(rows[0].payload as object).sort()).toEqual(['contactLeadId', 'event', 'occurredAt']);
    expect(bodies[0].to).toBe('77010000001');
    expect(bodies[0].template.name).toBe('new_contact_lead');
    expect(bodies[0].template.components[0].parameters.map((p) => p.text)).toEqual(['ITEST Уведомление', phone, 'Позвоните мне']);

    // Already SENT for this lead: a second emit does not send again.
    await service.emitContactLeadEvent(events.buildContactLeadEvent(lead.id), { channels: () => [channel] });
    expect(bodies).toHaveLength(1);
    expect(await prisma.notificationDelivery.count({ where: { contactLeadId: lead.id } })).toBe(1);

    const listed = await admin.listContactLeads();
    const shown = listed.leads.find((l) => l.id === lead.id);
    expect(shown).toMatchObject({ name: 'ITEST Уведомление', phone, notifications: [{ channel: 'whatsapp', state: 'SENT' }] });
  });

  it('order.created → WhatsApp failure: order and its stored totals untouched, FAILED row scheduled for retry', async () => {
    const phone = newPhone();
    const orderNumber = orders.generateOrderNumber();
    orderNumbers.push(orderNumber);
    const saved = await orders.saveOrder({
      id: crypto.randomUUID(),
      orderNumber,
      status: 'NEW',
      customer: { fullName: 'ITEST Заказчик', phone, city: 'Астана', type: 'INDIVIDUAL' },
      paymentPreference: 'BANK_TRANSFER',
      items: [
        {
          configuration: { modelSlug: 'ms-standard', quantity: 1 } as OrderRecord['items'][number]['configuration'],
          bom: [],
          breakdown: { unitNet: 100_000, net: 100_000 } as OrderRecord['items'][number]['breakdown'],
          modelName: 'MS Стандарт',
        },
      ],
      netTotal: 100_000,
      vatTotal: 12_000,
      discountTotal: 0,
      grandTotal: 112_000,
      createdAt: new Date().toISOString(),
    });
    orderNumbers.push(saved.orderNumber);

    const failing = whatsapp.createWhatsAppChannel({
      config: ready(),
      fetch: async () => ({ ok: false, status: 503, json: async () => ({ error: { code: 131016 } }) }),
    });
    const event = events.buildOrderEvent({ event: 'order.created', orderNumber: saved.orderNumber, status: 'NEW', grandTotal: saved.grandTotal });
    await service.emitOrderEvent(event, { channels: () => [failing] });

    const order = await prisma.order.findUnique({ where: { orderNumber: saved.orderNumber } });
    expect(order).not.toBeNull();
    expect(Number(order!.grandTotal)).toBe(112_000);
    expect(Number(order!.netTotal)).toBe(100_000);
    const [row] = await prisma.notificationDelivery.findMany({ where: { orderNumber: saved.orderNumber } });
    expect(row).toMatchObject({ status: 'FAILED', lastError: 'HTTP_503_META_131016', contactLeadId: null, attempts: 1 });
    expect(row.nextAttemptAt).not.toBeNull();

    // The template the manager would get carries the stored total.
    const bodies: string[] = [];
    const ok = whatsapp.createWhatsAppChannel({
      config: ready(),
      fetch: async (_url, init) => {
        bodies.push(init.body);
        return { ok: true, status: 200 };
      },
    });
    expect(await ok.send(event)).toEqual({ ok: true });
    const params = JSON.parse(bodies[0]).template.components[0].parameters.map((p: { text: string }) => p.text);
    expect(params[0]).toBe(saved.orderNumber);
    expect(params[4]).toMatch(/^112\s000 ₸$/);
  });

  it('a PENDING row from a crashed sender is due after its lease and is claimed by exactly one worker', async () => {
    const phone = newPhone();
    const { lead } = await store.saveContactLead({ name: 'ITEST Сбой', phone, message: 'Процесс упал', locale: 'ru' });
    leadIds.push(lead.id);
    const start = new Date();
    const lease = new Date(start.getTime() + 60_000);
    const event = events.buildContactLeadEvent(lead.id);
    const id = await outbox.createPendingDelivery({
      event: event.event,
      channel: 'whatsapp',
      subject: { contactLeadId: lead.id },
      payload: event,
      leaseUntil: lease,
      createdAt: start,
    });
    expect((await outbox.listDueDeliveries(new Date(lease.getTime() - 1), 1000)).some((r) => r.id === id)).toBe(false);
    const due = (await outbox.listDueDeliveries(lease, 1000)).find((r) => r.id === id);
    expect(due).toMatchObject({ status: 'PENDING', attempts: 0, contactLeadId: lead.id });

    const nextLease = new Date(lease.getTime() + 5 * 60_000);
    const claims = await Promise.all([
      outbox.claimDelivery(id, due!.nextAttemptAt!, nextLease),
      outbox.claimDelivery(id, due!.nextAttemptAt!, nextLease),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await outbox.markDeliveryResult(id, { ok: true }, null);
    expect(await prisma.notificationDelivery.findUnique({ where: { id } })).toMatchObject({ status: 'SENT', attempts: 1, nextAttemptAt: null });
    expect(await outbox.hasSentDelivery('contact.created', 'whatsapp', { contactLeadId: lead.id })).toBe(true);
    expect(await outbox.hasSentDelivery('contact.created', 'whatsapp', { contactLeadId: 'other' })).toBe(false);
  });
});
