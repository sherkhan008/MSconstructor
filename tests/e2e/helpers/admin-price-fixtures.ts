import { PrismaClient, Prisma } from '@prisma/client';
import { hashPassword } from '../../../src/lib/auth/password';
import { SESSION_COOKIE_NAME, createSessionToken } from '../../../src/lib/auth/session';

/**
 * Isolated catalog fixtures for the /admin/prices browser tests.
 *
 * These tests must never edit a real catalog price: a left-over price change
 * would silently move what customers are quoted. So instead of borrowing
 * existing rows and restoring them afterwards, each run creates its own
 * Component/Accessory rows and deletes them (with their price history and
 * audit trail) when it finishes.
 *
 * Every fixture row is `active: false`, which keeps it out of the customer
 * catalog entirely — src/lib/data/db-repository.ts selects `where active:
 * true`, so a fixture can never reach pricing, BOM or the configurator, while
 * the admin price list (which reads the tables directly, by design) still
 * shows it.
 *
 * Each Playwright project gets its own `prefix`, so desktop-chromium and
 * mobile-chromium can run in parallel without touching each other's rows.
 */

export const FIXTURE_PASSWORD = 'E2ePriceFixture123!';

/** Every admin role, so the permission matrix is tested against real accounts. */
export const FIXTURE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CONTENT_MANAGER'] as const;
export type FixtureRole = (typeof FIXTURE_ROLES)[number];

export interface FixtureUser {
  id: string;
  email: string;
  name: string;
  role: FixtureRole;
}

export interface PriceFixtures {
  prefix: string;
  upright: { sku: string; id: string; selling: string; purchase: string };
  shelf: { sku: string; id: string; selling: string; purchase: string };
  beam: { sku: string; id: string; selling: string; purchase: string };
  accessory: { sku: string; id: string; selling: string; purchase: string };
  users: Record<FixtureRole, FixtureUser>;
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

/** Safe as an ILIKE search term and as a SKU fragment. */
export function fixturePrefix(projectName: string): string {
  return `E2EPRICE${projectName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`;
}

export async function createPriceFixtures(
  prisma: PrismaClient,
  prefix: string,
): Promise<PriceFixtures> {
  await removePriceFixtures(prisma, prefix);

  const passwordHash = hashPassword(FIXTURE_PASSWORD);
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

  const upright = await prisma.component.create({
    data: {
      sku: `${prefix}-UPR-1`,
      type: 'UPRIGHT',
      nameRu: `${prefix} Стойка 2000 мм`,
      nameKk: `${prefix} Тірек 2000 мм`,
      sellingPrice: new Prisma.Decimal('12000.00'),
      purchasePrice: new Prisma.Decimal('7500.00'),
      weightKg: new Prisma.Decimal('6.20'),
      height: 2000,
      models: [],
      colors: [],
      active: false,
    },
  });

  // Deliberately carries tiyn: the UI must show and round-trip "9 500.50 ₸"
  // without turning it into a float.
  const shelf = await prisma.component.create({
    data: {
      sku: `${prefix}-SHL-1`,
      type: 'SHELF',
      nameRu: `${prefix} Полка 1000×400`,
      nameKk: `${prefix} Сөре 1000×400`,
      sellingPrice: new Prisma.Decimal('9500.50'),
      purchasePrice: new Prisma.Decimal('6000.25'),
      weightKg: new Prisma.Decimal('4.10'),
      width: 1000,
      depth: 400,
      shelfType: 'STANDARD',
      models: ['ms-standard'],
      colors: [],
      active: false,
    },
  });

  const beam = await prisma.component.create({
    data: {
      sku: `${prefix}-BML-1`,
      type: 'BEAM_LONGITUDINAL',
      nameRu: `${prefix} Балка продольная 1200 мм`,
      nameKk: `${prefix} Бойлық арқалық 1200 мм`,
      sellingPrice: new Prisma.Decimal('4300.00'),
      purchasePrice: new Prisma.Decimal('2800.00'),
      weightKg: new Prisma.Decimal('2.90'),
      width: 1200,
      models: [],
      colors: [],
      active: false,
    },
  });

  const accessory = await prisma.accessory.create({
    data: {
      sku: `${prefix}-ACC-1`,
      slug: `${prefix.toLowerCase()}-acc-1`,
      nameRu: `${prefix} Разделитель полки`,
      nameKk: `${prefix} Сөре бөлгіші`,
      descriptionRu: 'Тестовая позиция e2e.',
      descriptionKk: 'E2e сынақ позициясы.',
      image: '/images/accessories/divider.svg',
      unitPrice: new Prisma.Decimal('3400.00'),
      purchasePrice: new Prisma.Decimal('1900.00'),
      weightKg: new Prisma.Decimal('0.70'),
      models: [],
      active: false,
    },
  });

  return {
    prefix,
    upright: { sku: upright.sku, id: upright.id, selling: '12000.00', purchase: '7500.00' },
    shelf: { sku: shelf.sku, id: shelf.id, selling: '9500.50', purchase: '6000.25' },
    beam: { sku: beam.sku, id: beam.id, selling: '4300.00', purchase: '2800.00' },
    accessory: { sku: accessory.sku, id: accessory.id, selling: '3400.00', purchase: '1900.00' },
    users,
  };
}

/**
 * Removes every trace of a fixture run: the catalog rows, the price history
 * they accumulated, the audit entries recorded for them, and the four extra
 * admin accounts. Real catalog prices are never touched because they were
 * never edited.
 */
export async function removePriceFixtures(prisma: PrismaClient, prefix: string): Promise<void> {
  const components = await prisma.component.findMany({
    where: { sku: { startsWith: prefix } },
    select: { id: true },
  });
  const accessories = await prisma.accessory.findMany({
    where: { sku: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = [...components, ...accessories].map((row) => row.id);

  if (ids.length > 0) {
    await prisma.priceHistory.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  }

  await prisma.component.deleteMany({ where: { sku: { startsWith: prefix } } });
  await prisma.accessory.deleteMany({ where: { sku: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix.toLowerCase() } } });
}

/**
 * A genuine, signed session for one fixture account.
 *
 * Minted with the app's own createSessionToken() rather than by driving the
 * login form: the login route is rate-limited to 10 attempts a minute per
 * client, and a suite that logs in once per role per project would start
 * failing for that reason instead of for a price bug. The login flow itself is
 * covered by tests/e2e/admin.spec.ts; what these tests need is a valid session
 * of a given role, which this produces through exactly the same HMAC path the
 * server verifies.
 */
export async function sessionCookieFor(user: FixtureUser, baseURL: string) {
  return {
    name: SESSION_COOKIE_NAME,
    value: await createSessionToken(user),
    url: baseURL,
  };
}

/**
 * Simulates a *different* admin committing a price change between the moment
 * the dialog loaded a row and the moment it saves — the exact situation the
 * optimistic-concurrency guard exists for. Writing through Prisma bumps
 * `updatedAt`, which is the concurrency token the PATCH compares against.
 */
export async function changeSellingPriceBehindTheUi(
  prisma: PrismaClient,
  componentId: string,
  value: string,
): Promise<void> {
  await prisma.component.update({
    where: { id: componentId },
    data: { sellingPrice: new Prisma.Decimal(value) },
  });
}

export async function readPrices(
  prisma: PrismaClient,
  componentId: string,
): Promise<{ selling: string; purchase: string }> {
  const row = await prisma.component.findUniqueOrThrow({
    where: { id: componentId },
    select: { sellingPrice: true, purchasePrice: true },
  });
  return { selling: row.sellingPrice.toFixed(2), purchase: row.purchasePrice.toFixed(2) };
}
