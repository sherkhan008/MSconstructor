import { createClientIpPolicy } from '@/lib/security/client-ip';
import { parseRedisUrl } from '@/lib/redis/resp-client';
import { resolvePaymentsAvailability } from '@/lib/payments/config';
import { resolveWhatsAppConfig, type WhatsAppEnvInput } from '@/lib/notifications/providers/whatsapp-config';

/**
 * Production runtime configuration check, run once when the server starts
 * (src/instrumentation.ts → src/lib/startup/preflight.ts).
 *
 * `errors` are security- or integrity-critical: the server refuses to start
 * (fail closed) rather than run with a forgeable session secret, a missing
 * database, or a client-IP contract that collapses every customer into one
 * rate-limit bucket. `warnings` are logged but do not block startup.
 *
 * Pure function of its input so every rule is unit-testable. Messages name
 * the variable and the problem — never the value.
 */

export interface ProductionConfigInput extends WhatsAppEnvInput {
  /** Server variables that failed schema validation in src/lib/env.ts (names only). */
  invalidVariables?: readonly string[];
  DATABASE_URL?: string;
  AUTH_SECRET?: string;
  APP_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  TRUSTED_PROXY_CLIENT_IP_HEADER?: string;
  REDIS_URL?: string;
  ADMIN_INITIAL_PASSWORD?: string;
  NEXT_PUBLIC_WHATSAPP_NUMBER?: string;
  PAYMENTS_ENABLED?: string;
  PAYMENTS_PROVIDER?: string;
}

export interface ProductionConfigReport {
  errors: string[];
  warnings: string[];
}

export const AUTH_SECRET_MIN_LENGTH = 32;

/** Fragments of the placeholder values shipped in .env*.example / old compose defaults. */
const PLACEHOLDER_FRAGMENTS = ['change-me', 'changeme', 'replace-with', 'generate-with', 'your-domain', 'placeholder'];

function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function checkProductionConfig(input: ProductionConfigInput): ProductionConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input.invalidVariables && input.invalidVariables.length > 0) {
    errors.push(
      `Invalid environment variables: ${input.invalidVariables.join(', ')}. ` +
        'An empty assignment (VAR=) is invalid — remove the line or set a real value.',
    );
  }

  // --- Database -------------------------------------------------------------
  const databaseUrl = input.DATABASE_URL?.trim();
  if (!databaseUrl) {
    errors.push('DATABASE_URL is required.');
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a postgresql:// connection string.');
  } else if (/\/\/user:password@host[:/]/.test(databaseUrl)) {
    errors.push('DATABASE_URL still contains the .env.production.example placeholder.');
  }

  // --- Admin session signing key ------------------------------------------
  const authSecret = input.AUTH_SECRET?.trim();
  if (!authSecret) {
    errors.push('AUTH_SECRET is required (generate with: openssl rand -base64 48).');
  } else if (looksLikePlaceholder(authSecret)) {
    errors.push('AUTH_SECRET is a placeholder value; generate a random secret.');
  } else if (authSecret.length < AUTH_SECRET_MIN_LENGTH) {
    errors.push(`AUTH_SECRET must be at least ${AUTH_SECRET_MIN_LENGTH} characters.`);
  }

  // --- Public origin -------------------------------------------------------
  const appUrlRaw = input.NEXT_PUBLIC_APP_URL?.trim() || input.APP_URL?.trim();
  if (!appUrlRaw) {
    errors.push('APP_URL is required.');
  } else {
    const appUrl = parseHttpUrl(appUrlRaw);
    if (!appUrl) {
      errors.push('APP_URL must be an absolute http(s) URL.');
    } else if (looksLikePlaceholder(appUrl.hostname)) {
      errors.push('APP_URL still contains the .env.production.example placeholder domain.');
    } else if (appUrl.protocol !== 'https:') {
      warnings.push('APP_URL is not https://. Use plain HTTP only for local production rehearsals.');
    }
  }

  // --- Client IP trust contract (rate limiting, audit log) -----------------
  const header = input.TRUSTED_PROXY_CLIENT_IP_HEADER?.trim();
  if (!header) {
    errors.push(
      'TRUSTED_PROXY_CLIENT_IP_HEADER is required (x-real-ip behind deploy/nginx/default.conf). ' +
        'Without it every client shares one rate-limit bucket. See docs/production-client-ip-and-rate-limiting.md.',
    );
  } else if (createClientIpPolicy({ trustedHeader: header, productionRuntime: true }).mode !== 'trusted-proxy-header') {
    errors.push('TRUSTED_PROXY_CLIENT_IP_HEADER is not a valid HTTP header name.');
  }

  // --- Shared rate-limit store ---------------------------------------------
  const redisUrl = input.REDIS_URL?.trim();
  if (!redisUrl) {
    warnings.push('REDIS_URL is not set: rate limits are per-process memory (correct for one app instance only).');
  } else {
    try {
      parseRedisUrl(redisUrl);
    } catch {
      errors.push('REDIS_URL is not a valid redis:// or rediss:// URL.');
    }
  }

  // --- Online payment (off by default) -------------------------------------
  // The flag is read here exactly as the runtime reads it, so a deployment
  // cannot believe payment is on while the app has it off. Booting with a
  // provider that this build has no adapter for is an ERROR rather than a
  // silent fallback: a shop that thinks it can take money online but cannot
  // is worse than one that knows it cannot.
  const paymentsEnabledRaw = input.PAYMENTS_ENABLED?.trim();
  if (paymentsEnabledRaw !== undefined && paymentsEnabledRaw !== 'true' && paymentsEnabledRaw !== 'false') {
    warnings.push('PAYMENTS_ENABLED is neither "true" nor "false"; online payment stays disabled.');
  }
  if (paymentsEnabledRaw === 'true') {
    const availability = resolvePaymentsAvailability({
      PAYMENTS_ENABLED: paymentsEnabledRaw,
      PAYMENTS_PROVIDER: input.PAYMENTS_PROVIDER,
    });
    if (!availability.available) {
      errors.push(
        'PAYMENTS_ENABLED is true but PAYMENTS_PROVIDER does not name a payment provider adapter this build has. ' +
          'Register the adapter in src/lib/payments/registry.ts, or set PAYMENTS_ENABLED=false.',
      );
    }
  }

  // --- WhatsApp new-order admin alert (off by default) ----------------------
  // Disabled (the default) needs nothing. Enabled with incomplete credentials
  // is an ERROR: the owner would believe new orders reach their WhatsApp
  // while none ever would.
  const whatsappEnabledRaw = input.WHATSAPP_NOTIFICATIONS_ENABLED?.trim();
  if (whatsappEnabledRaw !== undefined && whatsappEnabledRaw !== 'true' && whatsappEnabledRaw !== 'false') {
    warnings.push('WHATSAPP_NOTIFICATIONS_ENABLED is neither "true" nor "false"; WhatsApp notifications stay disabled.');
  }
  const whatsapp = resolveWhatsAppConfig(input);
  if (whatsapp.state === 'invalid') {
    errors.push(
      `WHATSAPP_NOTIFICATIONS_ENABLED is true but the configuration is incomplete: ${whatsapp.problems.join('; ')}. ` +
        'Set the missing values or set WHATSAPP_NOTIFICATIONS_ENABLED=false.',
    );
  }

  // --- Values that should not be here, or are business-critical -----------
  if (input.ADMIN_INITIAL_PASSWORD) {
    warnings.push('ADMIN_INITIAL_PASSWORD is set in the app runtime environment; it is only needed for the one-time seed. Remove it.');
  }
  // WhatsApp is the seller's only published contact channel — there is no
  // public voice number (src/lib/config/site.ts). Serving the development
  // fallback would leave every customer with a dead link and no way to
  // reach the shop, so this fails closed rather than warning.
  if (!input.NEXT_PUBLIC_WHATSAPP_NUMBER) {
    errors.push(
      'NEXT_PUBLIC_WHATSAPP_NUMBER was not set when this image was built: WhatsApp is the only public contact ' +
        'channel and its links would be non-functional. It is inlined at build time — pass it as a build argument.',
    );
  }

  return { errors, warnings };
}
