import { PrismaClient, Prisma } from '@prisma/client';
import { hashPassword } from '../../../src/lib/auth/password';
import { SESSION_COOKIE_NAME, createSessionToken } from '../../../src/lib/auth/session';

/**
 * Isolated order fixtures for the /admin/orders browser tests.
 *
 * Why this exists: the admin specs used to open "the newest order in the
 * table" and change its status. That is wrong twice over — it mutates a real
 * customer's order, and the desktop and mobile Playwright projects run in
 * parallel against the same database, so both would grab the SAME newest row
 * and fight over its status, manager and notes.
 *
 * Instead each project creates its own orders, its own customers and its own
 * admin accounts, all carrying a per-project prefix, and deletes exactly
 * those rows afterwards. Nothing is "restored" because nothing real is ever
 * touched: the tests only ever act on orders they created themselves, found
 * by their deterministic order numbers rather than by position in a list.
 *
 * Fixture orders are ordinary Order rows (there is no "test" flag on the
 * schema, and inventing one would change the order model for everybody), so
 * the two things that keep them out of the way are the prefix and the
 * cleanup. Their customers use a reserved +7900… phone range that no real
 * Kazakh mobile number occupies.
 */

export const ORDER_FIXTURE_PASSWORD = 'E2eOrderFixture123!';

export const FIXTURE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CONTENT_MANAGER'] as const;
export type FixtureRole = (typeof FIXTURE_ROLES)[number];

/** A second manager account, so "this order belongs to someone else" is a
 * real other person rather than a role the test is signed in as. */
export const OTHER_MANAGER_KEY = 'MANAGER_2';

export interface FixtureUser {
  id: string;
  email: string;
  name: string;
  role: FixtureRole;
}

export interface FixtureOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
}

export interface OrderFixtures {
  prefix: string;
  /** NEW, nobody responsible, individual customer — the claim/assign subject. */
  unassigned: FixtureOrder;
  /** CONTACTED, already held by another manager — the "cannot take" subject. */
  assigned: FixtureOrder & { managerId: string; managerName: string };
  /** PAID, 40 days old, legal entity — the search/filter subject. */
  legacy: FixtureOrder & { companyName: string; binIin: string };
  users: Record<FixtureRole, FixtureUser>;
  otherManager: FixtureUser;
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

/** Safe inside an order number, a SKU-like search term and an email local part. */
export function orderFixturePrefix(projectName: string): string {
  return `E2EORD${projectName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`;
}

/** A stable 4-digit suffix per project, so two projects never collide on the
 * Customer(phone, type) unique key. */
function phoneSeed(prefix: string): number {
  let hash = 0;
  for (const char of prefix) hash = (hash * 31 + char.charCodeAt(0)) % 9000;
  return 1000 + hash;
}

function fixturePhone(prefix: string, index: number): string {
  return `+7900${String(phoneSeed(prefix)).padStart(4, '0')}${String(index).padStart(3, '0')}`;
}

function configurationJson(width: number): Prisma.InputJsonValue {
  return {
    modelSlug: 'ms-standard',
    height: 2000,
    depth: 500,
    shelves: 5,
    loadCapacity: 150,
    shelfType: 'STANDARD',
    colorId: 'color-grey',
    accessories: [],
    assemblyId: 'assembly-self',
    deliveryId: 'delivery-pickup',
    quantity: 1,
    metalFootPad: false,
    shelfCornerBrackets: false,
    sections: [{ id: 'sec-1', width, rearWall: false, leftWall: false, rightWall: false }],
  };
}

/** An internal BOM snapshot: component-level detail with no cost fields, the
 * same shape stripBomCosts() writes when a real order is placed. */
function bomJson(): Prisma.InputJsonValue {
  return [
    {
      componentId: 'fixture-upright',
      sku: 'MS-UPR-2000',
      type: 'UPRIGHT',
      name: 'Стойка 2000 мм',
      quantity: 4,
      unitPrice: 12000,
      totalPrice: 48000,
      weightKg: 6.2,
    },
    {
      componentId: 'fixture-shelf',
      sku: 'MS-SHELF-1000-500',
      type: 'SHELF',
      name: 'Полка 1000×500',
      quantity: 5,
      unitPrice: 9500,
      totalPrice: 47500,
      weightKg: 4.1,
    },
  ];
}

export interface CreateOrderInput {
  prefix: string;
  index: number;
  status: 'NEW' | 'CONTACTED' | 'PAID';
  customerType: 'INDIVIDUAL' | 'LEGAL_ENTITY';
  fullName: string;
  companyName?: string;
  binIin?: string;
  managerId?: string;
  createdAt: Date;
  grandTotal: number;
  /** false = an order placed before document snapshots existed (legacy). */
  documentSnapshots?: boolean;
}

/**
 * The order-time snapshots POST /api/orders writes: the buyer as entered and
 * the item's labels, public kit and price breakdown (VAT-exclusive, one set,
 * self-assembly, free pickup). Amounts are consistent with the order columns:
 * goods = unit × 1 = net, net + vat = total.
 */
function documentSnapshotsJson(input: CreateOrderInput, phone: string, email: string, net: number) {
  const money = (tenge: number) => tenge.toFixed(2);
  const buyerSnapshot: Prisma.InputJsonValue = {
    version: 1,
    type: input.customerType,
    fullName: input.fullName,
    phone,
    email,
    city: 'Алматы',
    ...(input.customerType === 'LEGAL_ENTITY' && input.companyName ? { companyName: input.companyName } : {}),
    ...(input.binIin ? { binIin: input.binIin } : {}),
  };
  const documentSnapshot: Prisma.InputJsonValue = {
    version: 1,
    modelName: 'MS Стандарт',
    colorName: 'Стандартный серый',
    assemblyName: 'Самостоятельная сборка',
    deliveryName: 'Самовывоз со склада',
    options: [],
    kit: [
      { name: 'Стойка 2000 мм', quantity: 4 },
      { name: 'Полка 1000×500', quantity: 5 },
    ],
    pricing: {
      pricesIncludeVat: false,
      vatPercent: 16,
      quantity: 1,
      unitPrice: money(net),
      goodsAmount: money(net),
      assembly: '0.00',
      delivery: '0.00',
      discount: '0.00',
      net: money(net),
      vat: money(input.grandTotal - net),
      total: money(input.grandTotal),
    },
  };
  return { buyerSnapshot, documentSnapshot };
}

export async function createOrder(prisma: PrismaClient, input: CreateOrderInput) {
  const phone = fixturePhone(input.prefix, input.index);
  const customer = await prisma.customer.create({
    data: {
      type: input.customerType,
      fullName: input.fullName,
      phone,
      email: `${input.prefix.toLowerCase()}-${input.index}@e2e.invalid`,
      city: 'Алматы',
      companyName: input.companyName,
      binIin: input.binIin,
    },
  });

  const net = Math.round(input.grandTotal / 1.16);
  const snapshots =
    input.documentSnapshots === false ? null : documentSnapshotsJson(input, phone, customer.email ?? '', net);
  const order = await prisma.order.create({
    data: {
      orderNumber: `${input.prefix}-${String(input.index).padStart(4, '0')}`,
      customerId: customer.id,
      buyerSnapshot: snapshots?.buyerSnapshot,
      status: input.status,
      managerId: input.managerId,
      paymentPreference: 'BANK_TRANSFER',
      deliveryAddress: 'ул. Тестовая, 1',
      deliveryCity: 'Алматы',
      netTotal: new Prisma.Decimal(net),
      vatTotal: new Prisma.Decimal(input.grandTotal - net),
      discountTotal: new Prisma.Decimal(0),
      grandTotal: new Prisma.Decimal(input.grandTotal),
      createdAt: input.createdAt,
      items: {
        create: [
          {
            configuration: configurationJson(1000),
            bomSnapshot: bomJson(),
            documentSnapshot: snapshots?.documentSnapshot,
            quantity: 1,
            unitNetPrice: new Prisma.Decimal(net),
            totalNetPrice: new Prisma.Decimal(net),
          },
        ],
      },
      statusHistory: { create: [{ status: input.status, note: 'Заказ создан' }] },
    },
  });

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: customer.fullName,
    customerPhone: customer.phone,
  };
}

export async function createOrderFixtures(
  prisma: PrismaClient,
  prefix: string,
): Promise<OrderFixtures> {
  await removeOrderFixtures(prisma, prefix);

  const passwordHash = hashPassword(ORDER_FIXTURE_PASSWORD);
  const users = {} as Record<FixtureRole, FixtureUser>;
  for (const role of FIXTURE_ROLES) {
    const created = await prisma.user.create({
      data: {
        email: `${prefix.toLowerCase()}-${role.toLowerCase()}@e2e.invalid`,
        name: `${prefix} ${role}`,
        passwordHash,
        role,
        active: true,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    users[role] = { ...created, role };
  }

  const otherManagerRow = await prisma.user.create({
    data: {
      email: `${prefix.toLowerCase()}-${OTHER_MANAGER_KEY.toLowerCase()}@e2e.invalid`,
      name: `${prefix} Другой Менеджер`,
      passwordHash,
      role: 'MANAGER',
      active: true,
    },
    select: { id: true, email: true, name: true, role: true },
  });
  const otherManager: FixtureUser = { ...otherManagerRow, role: 'MANAGER' };

  const now = Date.now();
  const unassigned = await createOrder(prisma, {
    prefix,
    index: 1,
    status: 'NEW',
    customerType: 'INDIVIDUAL',
    fullName: `${prefix} Айгуль Тестова`,
    createdAt: new Date(now),
    grandTotal: 145_000,
  });

  const assignedOrder = await createOrder(prisma, {
    prefix,
    index: 2,
    status: 'CONTACTED',
    customerType: 'INDIVIDUAL',
    fullName: `${prefix} Ержан Занятый`,
    managerId: otherManager.id,
    createdAt: new Date(now - 60_000),
    grandTotal: 212_000,
  });

  const companyName = `${prefix} ТОО Ромашка`;
  const binIin = `${String(phoneSeed(prefix)).padStart(4, '0')}01020304`.slice(0, 12);
  const legacyOrder = await createOrder(prisma, {
    prefix,
    index: 3,
    status: 'PAID',
    customerType: 'LEGAL_ENTITY',
    fullName: `${prefix} Сергей Юрлицов`,
    companyName,
    binIin,
    createdAt: new Date(now - 40 * 24 * 60 * 60 * 1000),
    grandTotal: 980_000,
  });

  return {
    prefix,
    unassigned,
    assigned: { ...assignedOrder, managerId: otherManager.id, managerName: otherManager.name },
    legacy: { ...legacyOrder, companyName, binIin },
    users,
    otherManager,
  };
}

/**
 * Removes every row a fixture run created: the issued documents, the orders
 * (their items and status history cascade), the audit entries recorded
 * against them, the customers and the admin accounts. Real orders are never
 * touched because they were never used.
 */
export async function removeOrderFixtures(prisma: PrismaClient, prefix: string): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { orderNumber: { startsWith: prefix } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);

  if (orderIds.length > 0) {
    // Issued documents block order deletion (ON DELETE RESTRICT — a real
    // issued invoice must never vanish with its order), so they go first.
    await prisma.orderDocument.deleteMany({ where: { orderId: { in: orderIds } } });
    // Audit rows have no FK to Order, so they must go explicitly.
    await prisma.auditLog.deleteMany({ where: { entityId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  await prisma.customer.deleteMany({ where: { fullName: { startsWith: prefix } } });

  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix.toLowerCase() } },
    select: { id: true },
  });
  if (users.length > 0) {
    const userIds = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

/**
 * A genuine, signed session for one fixture account.
 *
 * Minted with the app's own createSessionToken() rather than by driving the
 * login form: the login route is rate-limited (10 attempts a minute per
 * client) and a suite that signs in once per role would start failing for
 * that reason instead of for an order bug. The production limiter is left
 * exactly as it is — these tests simply do not use that door. The login flow
 * itself is covered by tests/e2e/admin.spec.ts.
 */
export async function sessionCookieFor(user: FixtureUser, baseURL: string) {
  return {
    name: SESSION_COOKIE_NAME,
    value: await createSessionToken(user),
    url: baseURL,
  };
}

/** Simulates a *different* admin committing a change between the moment the
 * page rendered and the moment it saves — what the CAS guard exists for.
 * Writing through Prisma bumps `updatedAt`, the concurrency token. */
export async function assignManagerBehindTheUi(
  prisma: PrismaClient,
  orderId: string,
  managerId: string | null,
): Promise<void> {
  await prisma.order.update({ where: { id: orderId }, data: { managerId } });
}

export async function setInternalNotesBehindTheUi(
  prisma: PrismaClient,
  orderId: string,
  notes: string | null,
): Promise<void> {
  await prisma.order.update({ where: { id: orderId }, data: { internalNotes: notes } });
}

export async function readOrder(prisma: PrismaClient, orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { status: true, managerId: true, internalNotes: true, updatedAt: true },
  });
}
