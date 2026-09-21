import { z } from 'zod';

/**
 * Environment validation.
 *
 * Rule: nothing here may throw during local development. Every integration
 * credential is optional — a missing Telegram token or Kaspi key must never
 * prevent `npm run dev` from starting. Only genuinely required values are
 * enforced, and only in production.
 */

const optionalString = z.string().trim().min(1).optional();

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: optionalString,
  DIRECT_URL: optionalString,

  AUTH_SECRET: optionalString,
  AUTH_URL: optionalString,
  APP_URL: optionalString,

  ADMIN_EMAIL: optionalString,
  ADMIN_INITIAL_PASSWORD: optionalString,

  SMTP_HOST: optionalString,
  SMTP_PORT: optionalString,
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  EMAIL_FROM: optionalString,
  MANAGER_EMAIL: optionalString,

  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_CHAT_ID: optionalString,

  // Internal new-order WhatsApp alert to the admin (official Cloud API,
  // template message). OFF unless WHATSAPP_NOTIFICATIONS_ENABLED is exactly
  // "true"; the rest is validated then — see
  // src/lib/notifications/providers/whatsapp-config.ts. Server-only: never
  // mirror any of these into NEXT_PUBLIC_*.
  WHATSAPP_NOTIFICATIONS_ENABLED: optionalString,
  WHATSAPP_ACCESS_TOKEN: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  WHATSAPP_ADMIN_RECIPIENT: optionalString,
  WHATSAPP_TEMPLATE_NAME: optionalString,
  WHATSAPP_TEMPLATE_LANGUAGE: optionalString,
  WHATSAPP_GRAPH_API_VERSION: optionalString,

  AMOCRM_WEBHOOK_URL: optionalString,
  BITRIX24_WEBHOOK_URL: optionalString,

  STORAGE_ENDPOINT: optionalString,
  STORAGE_ACCESS_KEY: optionalString,
  STORAGE_SECRET_KEY: optionalString,
  STORAGE_BUCKET: optionalString,

  REDIS_URL: optionalString,

  // Online payment. OFF unless PAYMENTS_ENABLED is the exact string "true" —
  // anything else (unset, empty, "1", "yes", "True") leaves it off, so a typo
  // fails closed. PAYMENTS_PROVIDER names which adapter to use
  // (src/lib/payments/registry.ts); a provider's own credentials belong in
  // that adapter's variables and never in source. See
  // src/lib/payments/config.ts.
  PAYMENTS_ENABLED: optionalString,
  PAYMENTS_PROVIDER: optionalString,

  // Header a trusted reverse proxy OVERWRITES with the connecting client's
  // IP (e.g. "x-real-ip"). Only set this when the app port is reachable
  // exclusively through that proxy — see src/lib/security/client-ip.ts and
  // docs/production-client-ip-and-rate-limiting.md.
  TRUSTED_PROXY_CLIENT_IP_HEADER: optionalString,

  // Seller legal/banking details printed on admin-generated order documents
  // (commercial proposal, invoice) — see src/lib/documents/seller.ts. Kept in
  // the environment, never in source: nothing here has a default, and a
  // missing value is reported to the admin instead of being made up.
  SELLER_LEGAL_NAME: optionalString,
  SELLER_BIN: optionalString,
  SELLER_ADDRESS: optionalString,
  SELLER_PHONE: optionalString,
  SELLER_EMAIL: optionalString,
  SELLER_BANK_NAME: optionalString,
  SELLER_IBAN: optionalString,
  SELLER_BIC: optionalString,
  SELLER_KBE: optionalString,
  SELLER_KNP: optionalString,
});

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: optionalString,
  NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: optionalString,
  NEXT_PUBLIC_YANDEX_METRICA_ID: optionalString,
  // Digits only, including country code (e.g. "77071234567") — see
  // src/lib/config/site.ts, which sanitises and falls back to a placeholder
  // for this specifically because it's what every wa.me deep link uses.
  NEXT_PUBLIC_WHATSAPP_NUMBER: optionalString,
});

const parsedServer = serverSchema.safeParse(process.env);
const parsedPublic = publicSchema.safeParse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID,
  NEXT_PUBLIC_YANDEX_METRICA_ID: process.env.NEXT_PUBLIC_YANDEX_METRICA_ID,
  NEXT_PUBLIC_WHATSAPP_NUMBER: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER,
});

/**
 * NODE_ENV as the process actually runs, independent of the rest of the
 * schema: one malformed variable (e.g. an empty `SMTP_PASSWORD=`) must never
 * turn a production process into a "development" one — that would silently
 * enable the development client-IP trust mode, non-Secure session cookies
 * and the in-memory catalog.
 */
const runtimeNodeEnv = serverSchema.shape.NODE_ENV.safeParse(process.env.NODE_ENV);

/** Server-only environment. Never import this from a Client Component. */
export const env = parsedServer.success
  ? parsedServer.data
  : ({ NODE_ENV: runtimeNodeEnv.success ? runtimeNodeEnv.data : 'development' } as z.infer<typeof serverSchema>);

/**
 * Names of server variables that failed validation (never their values).
 * When non-empty, `env` holds only NODE_ENV; production startup refuses to
 * continue (src/lib/startup/preflight.ts).
 */
export const invalidEnvVariables: string[] = parsedServer.success
  ? []
  : [...new Set(parsedServer.error.issues.map((issue) => issue.path.join('.')))];

/** Values that are safe to inline into the browser bundle. */
export const publicEnv = parsedPublic.success ? parsedPublic.data : {};

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/**
 * True when a real PostgreSQL connection string is present. When false the app
 * transparently falls back to the in-memory development catalog so the MVP runs
 * from a clean checkout with zero infrastructure. In production this fallback
 * must never be reached — see `isProductionRuntime`/`assertDatabaseConfigured`
 * below.
 */
export const hasDatabase = Boolean(env.DATABASE_URL && env.DATABASE_URL.startsWith('postgres'));

/**
 * `next build` sets NODE_ENV=production for its static-generation phase even
 * when run in a build pipeline with no database access (a common deploy
 * pattern: build now, deploy — and connect to the real database — later).
 * Next.js marks that phase with NEXT_PHASE=phase-production-build. Genuine
 * production *runtime* (dev server aside, this covers `next start` and every
 * serverless invocation) is production minus that build phase — this is the
 * only case where a missing database may never silently fall back to memory.
 */
export const isProductionBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
export const isProductionRuntime = isProduction && !isProductionBuildPhase;

export class DatabaseRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseRequiredError';
  }
}

/**
 * Call at the top of every function that can read or write business records
 * (catalog, orders, payments). No-ops outside genuine production runtime, or
 * when DATABASE_URL is a real PostgreSQL connection string. Otherwise throws
 * — deliberately never silently continues on the in-memory/mock path, which
 * is the whole point (spec: production must never serve orders from RAM).
 * The message never includes the connection string itself.
 */
export function assertDatabaseConfigured(context: string): void {
  if (!isProductionRuntime) return;
  if (!env.DATABASE_URL) {
    throw new DatabaseRequiredError(`DATABASE_URL is required in production (${context}).`);
  }
  if (!hasDatabase) {
    throw new DatabaseRequiredError(`DATABASE_URL must be a PostgreSQL connection string in production (${context}).`);
  }
}

/**
 * Admin is PostgreSQL-only in every environment — there is no in-memory
 * admin data source (unlike the customer catalog/order paths, which allow a
 * mock/memory fallback in dev). Call at the top of every admin data
 * function (src/lib/admin/orders.ts) so a dev machine without DATABASE_URL
 * fails with a clear message instead of a confusing Prisma connection error.
 */
export function assertAdminDatabaseConfigured(): void {
  if (!hasDatabase) {
    throw new DatabaseRequiredError('Admin requires a configured PostgreSQL DATABASE_URL.');
  }
}

export const appUrl =
  publicEnv.NEXT_PUBLIC_APP_URL ?? env.APP_URL ?? 'http://localhost:3000';

export const integrations = {
  email: Boolean(env.SMTP_HOST && env.SMTP_USER),
  telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  amocrm: Boolean(env.AMOCRM_WEBHOOK_URL),
  bitrix24: Boolean(env.BITRIX24_WEBHOOK_URL),
  storage: Boolean(env.STORAGE_ENDPOINT && env.STORAGE_BUCKET),
  redis: Boolean(env.REDIS_URL),
  // The flag only. Whether a usable provider is actually behind it is a
  // separate question, answered by src/lib/payments/config.ts.
  payments: env.PAYMENTS_ENABLED === 'true',
  googleAnalytics: Boolean(publicEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID),
  yandexMetrica: Boolean(publicEnv.NEXT_PUBLIC_YANDEX_METRICA_ID),
} as const;

// Production startup configuration checks (fail closed) live in
// src/lib/startup/production-config.ts, run from src/instrumentation.ts.
