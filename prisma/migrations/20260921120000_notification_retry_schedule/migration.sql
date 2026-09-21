-- Automatic retry schedule for the notification outbox. Additive only: one
-- nullable column and one index on "NotificationDelivery"; no other table is
-- read or modified. Older app images ignore the column (expand-only), so an
-- application rollback stays safe.
ALTER TABLE "NotificationDelivery" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- FAILED rows recorded before this migration had no schedule. Make the ones
-- with a transient error code, still under the attempt limit (6) and less than
-- a day old, due now; permanent errors stay final.
UPDATE "NotificationDelivery"
SET "nextAttemptAt" = CURRENT_TIMESTAMP
WHERE "status" = 'FAILED'
  AND "attempts" < 6
  AND "createdAt" > CURRENT_TIMESTAMP - INTERVAL '1 day'
  AND ("lastError" IN ('TIMEOUT', 'NETWORK_ERROR', 'ORDER_LOOKUP_FAILED', 'ADAPTER_ERROR')
       OR "lastError" ~ '^HTTP_(408|429|5[0-9][0-9])');
