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

  WHATSAPP_API_URL: optionalString,
  WHATSAPP_API_TOKEN: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,

  AMOCRM_WEBHOOK_URL: optionalString,
  BITRIX24_WEBHOOK_URL: optionalString,

  STORAGE_ENDPOINT: optionalString,
  STORAGE_ACCESS_KEY: optionalString,
  STORAGE_SECRET_KEY: optionalString,
  STORAGE_BUCKET: optionalString,

  REDIS_URL: optionalString,
});

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: optionalString,
  NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: optionalString,
  NEXT_PUBLIC_YANDEX_METRICA_ID: optionalString,
});

const parsedServer = serverSchema.safeParse(process.env);
const parsedPublic = publicSchema.safeParse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID,
  NEXT_PUBLIC_YANDEX_METRICA_ID: process.env.NEXT_PUBLIC_YANDEX_METRICA_ID,
});

/** Server-only environment. Never import this from a Client Component. */
export const env = parsedServer.success
  ? parsedServer.data
  : ({ NODE_ENV: 'development' } as z.infer<typeof serverSchema>);

/** Values that are safe to inline into the browser bundle. */
export const publicEnv = parsedPublic.success ? parsedPublic.data : {};

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/**
 * True when a real PostgreSQL connection string is present. When false the app
 * transparently falls back to the in-memory development catalog so the MVP runs
 * from a clean checkout with zero infrastructure.
 */
export const hasDatabase = Boolean(env.DATABASE_URL && env.DATABASE_URL.startsWith('postgres'));

export const appUrl =
  publicEnv.NEXT_PUBLIC_APP_URL ?? env.APP_URL ?? 'http://localhost:3000';

export const integrations = {
  email: Boolean(env.SMTP_HOST && env.SMTP_USER),
  telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  whatsappApi: Boolean(env.WHATSAPP_API_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
  amocrm: Boolean(env.AMOCRM_WEBHOOK_URL),
  bitrix24: Boolean(env.BITRIX24_WEBHOOK_URL),
  storage: Boolean(env.STORAGE_ENDPOINT && env.STORAGE_BUCKET),
  redis: Boolean(env.REDIS_URL),
  googleAnalytics: Boolean(publicEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID),
  yandexMetrica: Boolean(publicEnv.NEXT_PUBLIC_YANDEX_METRICA_ID),
} as const;

/** Warn once at boot about production values that really should be set. */
export function assertProductionEnv(): string[] {
  if (!isProduction) return [];
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!env.AUTH_SECRET) missing.push('AUTH_SECRET');
  if (!env.APP_URL && !publicEnv.NEXT_PUBLIC_APP_URL) missing.push('APP_URL');
  return missing;
}
