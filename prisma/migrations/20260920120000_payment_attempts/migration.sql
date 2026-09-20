-- Payment attempts: provider-neutral foundation for a future online-payment
-- integration. Online payment stays DISABLED (PAYMENTS_ENABLED) — this
-- migration only prepares the table.
--
-- Scope: the "Payment" table ONLY. No other table is read or written. Orders,
-- order items, BOM/document snapshots, totals and issued documents are all
-- left exactly as they are. No row is deleted and no table is dropped.
--
-- Nothing in the application has ever created a Payment row (the three
-- checkout methods are manager-confirmed offline), so the value remaps below
-- exist for correctness, not because rows are expected to need them.

-- 1. `type` said nothing about what it held; it has always been the provider
--    identifier. Pure metadata rename — every existing value is preserved.
ALTER TABLE "Payment" RENAME COLUMN "type" TO "provider";

-- 2. Promote the free-text status to a real enum, the same way OrderStatus is
--    modelled. The legacy TypeScript union allowed SUCCEEDED and REFUNDED;
--    both mean "the money arrived", so both map to PAID. Any other unexpected
--    value is settled as FAILED rather than silently becoming PENDING, which
--    would wrongly present a dead attempt as still payable.
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED');

ALTER TABLE "Payment" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Payment"
  ALTER COLUMN "status" TYPE "PaymentStatus"
  USING (
    CASE "status"
      WHEN 'PENDING' THEN 'PENDING'
      WHEN 'PAID' THEN 'PAID'
      WHEN 'SUCCEEDED' THEN 'PAID'
      WHEN 'REFUNDED' THEN 'PAID'
      WHEN 'CANCELLED' THEN 'CANCELLED'
      WHEN 'EXPIRED' THEN 'EXPIRED'
      ELSE 'FAILED'
    END
  )::"PaymentStatus";

ALTER TABLE "Payment" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- 3. New columns. All are nullable or defaulted, so existing rows stay valid.
ALTER TABLE "Payment" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'KZT';
ALTER TABLE "Payment" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "Payment" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "pendingKey" TEXT;

-- 4. The idempotency guard. "<orderId>:<provider>" while the attempt is open,
--    NULL once it settles: PostgreSQL treats NULLs as distinct in a unique
--    index, so an order may hold any number of settled attempts but never two
--    open ones for the same provider. Backfilled for any pre-existing PENDING
--    row so the invariant holds for history too; DISTINCT ON keeps the oldest
--    open attempt per (orderId, provider) as the open one, and settles the
--    rest as EXPIRED rather than inventing a second payable transaction.
UPDATE "Payment" p
SET "status" = 'EXPIRED'
WHERE p."status" = 'PENDING'
  AND p."id" NOT IN (
    SELECT DISTINCT ON ("orderId", "provider") "id"
    FROM "Payment"
    WHERE "status" = 'PENDING'
    ORDER BY "orderId", "provider", "createdAt" ASC, "id" ASC
  );

UPDATE "Payment"
SET "pendingKey" = "orderId" || ':' || "provider"
WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "Payment_pendingKey_key" ON "Payment"("pendingKey");

CREATE INDEX "Payment_status_idx" ON "Payment"("status");
