/**
 * Next.js startup hook — runs once per server process before any request is
 * handled. Only the Node.js runtime performs the production configuration
 * check (src/lib/startup/preflight.ts); the Edge runtime (middleware) has
 * nothing to validate and no process to stop.
 *
 * The import must stay inside this exact `if`: Next.js replaces
 * `process.env.NEXT_RUNTIME` at compile time, which is what removes the
 * Node-only modules (node:net, node:tls) from the Edge bundle.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runProductionPreflight } = await import('@/lib/startup/preflight');
    runProductionPreflight();
  }
}
