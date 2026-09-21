import { env, invalidEnvVariables, isProductionRuntime, publicEnv } from '@/lib/env';
import { checkProductionConfig } from './production-config';

/**
 * Node-runtime startup check, called from src/instrumentation.ts. In
 * production runtime a security-critical misconfiguration stops the process
 * with exit code 1 — Next.js itself would only log "Failed to prepare
 * server" and keep answering every request with a 500, which looks alive to
 * a TCP check. Exiting makes the failure visible to Docker (restart loop,
 * failing healthcheck) and to scripts/ops/deploy.sh.
 */
export function runProductionPreflight(): void {
  if (!isProductionRuntime) return;

  const { errors, warnings } = checkProductionConfig({
    invalidVariables: invalidEnvVariables,
    DATABASE_URL: env.DATABASE_URL,
    AUTH_SECRET: env.AUTH_SECRET,
    APP_URL: env.APP_URL,
    NEXT_PUBLIC_APP_URL: publicEnv.NEXT_PUBLIC_APP_URL,
    TRUSTED_PROXY_CLIENT_IP_HEADER: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
    REDIS_URL: env.REDIS_URL,
    ADMIN_INITIAL_PASSWORD: env.ADMIN_INITIAL_PASSWORD,
    NEXT_PUBLIC_WHATSAPP_NUMBER: publicEnv.NEXT_PUBLIC_WHATSAPP_NUMBER,
    PAYMENTS_ENABLED: env.PAYMENTS_ENABLED,
    PAYMENTS_PROVIDER: env.PAYMENTS_PROVIDER,
    WHATSAPP_NOTIFICATIONS_ENABLED: env.WHATSAPP_NOTIFICATIONS_ENABLED,
    WHATSAPP_ACCESS_TOKEN: env.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: env.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_ADMIN_RECIPIENT: env.WHATSAPP_ADMIN_RECIPIENT,
    WHATSAPP_TEMPLATE_NAME: env.WHATSAPP_TEMPLATE_NAME,
    WHATSAPP_TEMPLATE_LANGUAGE: env.WHATSAPP_TEMPLATE_LANGUAGE,
    WHATSAPP_GRAPH_API_VERSION: env.WHATSAPP_GRAPH_API_VERSION,
  });

  for (const warning of warnings) console.warn(`[startup] WARNING: ${warning}`);
  if (errors.length === 0) return;

  for (const error of errors) console.error(`[startup] FATAL: ${error}`);
  console.error('[startup] Refusing to start with an unsafe production configuration. See .env.production.example.');
  process.exit(1);
}
