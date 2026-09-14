import { createClientIpPolicy } from '@/lib/security/client-ip';
import { parseRedisUrl } from '@/lib/redis/resp-client';

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

export interface ProductionConfigInput {
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

  // --- Values that should not be here, or are business-critical -----------
  if (input.ADMIN_INITIAL_PASSWORD) {
    warnings.push('ADMIN_INITIAL_PASSWORD is set in the app runtime environment; it is only needed for the one-time seed. Remove it.');
  }
  if (!input.NEXT_PUBLIC_WHATSAPP_NUMBER) {
    warnings.push(
      'NEXT_PUBLIC_WHATSAPP_NUMBER was not set when this image was built: WhatsApp links use a placeholder number. ' +
        'It is inlined at build time — pass it as a build argument.',
    );
  }

  return { errors, warnings };
}
