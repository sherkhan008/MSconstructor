-- Order status workflow.
--
-- Collapses the legacy 10-value lifecycle into the 8 business states the
-- workflow actually uses, so every order sits in a state the transition policy
-- (src/lib/orders/status-transitions.ts) knows how to move:
--
--   CONTACTED           -> CONFIRMED     (the manager is working the order)
--   APPROVED            -> CONFIRMED     (same meaning, kept as CONFIRMED)
--   PRODUCTION          -> IN_PROGRESS
--   READY_FOR_DELIVERY  -> READY
--   COMPLETED           -> DELIVERED     (both are the finished-order terminal)
--
-- NEW, AWAITING_PAYMENT, PAID, DELIVERED and CANCELLED keep their names and
-- their rows are not rewritten at all.
--
-- This migration only relabels the enum on Order."status" and
-- OrderStatusHistory."status". It touches NO other column: item snapshots,
-- BOM snapshots, unit/total prices, order totals, buyer snapshots and issued
-- OrderDocument rows are all left exactly as they were. No row is deleted and
-- no table is dropped.

CREATE TYPE "OrderStatus_new" AS ENUM (
  'NEW',
  'CONFIRMED',
  'AWAITING_PAYMENT',
  'PAID',
  'IN_PROGRESS',
  'READY',
  'DELIVERED',
  'CANCELLED'
);

-- The default references the old type and must go before the column is retyped.
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Order"
  ALTER COLUMN "status" TYPE "OrderStatus_new"
  USING (
    CASE "status"::text
      WHEN 'CONTACTED' THEN 'CONFIRMED'
      WHEN 'APPROVED' THEN 'CONFIRMED'
      WHEN 'PRODUCTION' THEN 'IN_PROGRESS'
      WHEN 'READY_FOR_DELIVERY' THEN 'READY'
      WHEN 'COMPLETED' THEN 'DELIVERED'
      ELSE "status"::text
    END
  )::"OrderStatus_new";

-- The history of past orders is remapped with the same rules, so an order's
-- timeline stays readable instead of half-speaking the retired vocabulary.
ALTER TABLE "OrderStatusHistory"
  ALTER COLUMN "status" TYPE "OrderStatus_new"
  USING (
    CASE "status"::text
      WHEN 'CONTACTED' THEN 'CONFIRMED'
      WHEN 'APPROVED' THEN 'CONFIRMED'
      WHEN 'PRODUCTION' THEN 'IN_PROGRESS'
      WHEN 'READY_FOR_DELIVERY' THEN 'READY'
      WHEN 'COMPLETED' THEN 'DELIVERED'
      ELSE "status"::text
    END
  )::"OrderStatus_new";

ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'NEW';

DROP TYPE "OrderStatus";

ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
