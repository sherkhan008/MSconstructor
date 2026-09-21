/**
 * The notifications worker loop (scripts/notification-retry-worker.ts, the
 * `notifications-worker` compose service). A plain timer loop in its own
 * process: no queue broker, no extra database — the outbox table is the
 * queue. Kept separate from the script so it is testable.
 *
 * One pass at a time (the next starts `intervalMs` after the previous one
 * finished, never overlapping), a failing pass is logged and the loop goes on,
 * and an abort stops it between passes.
 */

/** Seconds between passes. The shortest retry delay is 60 s, so a shorter tick buys nothing. */
export const RETRY_WORKER_INTERVAL_MS = 60_000;

export interface RetryLoopOptions {
  tick: () => Promise<number>;
  signal: AbortSignal;
  intervalMs?: number;
  log?: (line: string) => void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

export async function runRetryLoop({
  tick,
  signal,
  intervalMs = RETRY_WORKER_INTERVAL_MS,
  log = (line) => console.warn(line),
}: RetryLoopOptions): Promise<void> {
  while (!signal.aborted) {
    try {
      const sent = await tick();
      if (sent > 0) log(`[notifications-worker] retried deliveries sent=${sent}`);
    } catch (error) {
      // Error class only: a driver message could include a connection string.
      log(`[notifications-worker] pass failed error=${error instanceof Error ? error.name : 'unknown'}`);
    }
    await sleep(intervalMs, signal);
  }
}
