/**
 * Notifications retry worker — the `notifications-worker` service in
 * docker-compose.yml (image: ms-shelving-migrate, which ships src/, scripts/
 * and tsx). Every 60 s it re-sends FAILED notification deliveries whose retry
 * is due (src/lib/notifications/service.ts `retryFailedDeliveries`, policy in
 * src/lib/notifications/retry-policy.ts). The web app never retries.
 *
 *   tsx scripts/notification-retry-worker.ts          run until SIGTERM/SIGINT
 *   tsx scripts/notification-retry-worker.ts --once   one pass, then exit
 *
 * Refuses to start without PostgreSQL: the outbox must be the shared database
 * table, never this process's memory. Logs codes only, never tokens.
 */
import { env, hasDatabase, invalidEnvVariables } from '../src/lib/env';
import { resolveWhatsAppConfig } from '../src/lib/notifications/providers/whatsapp-config';
import { retryFailedDeliveries } from '../src/lib/notifications/service';
import { runRetryLoop } from '../src/lib/notifications/retry-worker';

function fatal(message: string): never {
  console.error(`[notifications-worker] FATAL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (invalidEnvVariables.length > 0) fatal(`invalid environment variables: ${invalidEnvVariables.join(', ')}`);
  if (!hasDatabase) fatal('DATABASE_URL must be a PostgreSQL connection string');
  const whatsapp = resolveWhatsAppConfig(env);
  if (whatsapp.state === 'invalid') fatal(`WhatsApp configuration is incomplete: ${whatsapp.problems.join('; ')}`);

  if (process.argv.includes('--once')) {
    const sent = await retryFailedDeliveries();
    console.warn(`[notifications-worker] single pass done sent=${sent}`);
  } else {
    const controller = new AbortController();
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => controller.abort());
    console.warn('[notifications-worker] started');
    await runRetryLoop({ tick: () => retryFailedDeliveries(), signal: controller.signal });
    console.warn('[notifications-worker] stopped');
  }

  const { prisma } = await import('../src/lib/db/client');
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  fatal(`unexpected error ${error instanceof Error ? error.name : 'unknown'}`);
});
