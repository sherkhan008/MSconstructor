-- PriceHistory: remove the impossible polymorphic dual foreign key and make
-- the table a real, durable audit trail for BOTH Component and Accessory
-- price changes.
--
-- The original design declared PriceHistory.entityId as a foreign key to
-- Component AND to Accessory simultaneously, so inserting a row required the
-- same id to exist in two different tables — no row could ever be written
-- (verified: 0 rows in this database), and ON DELETE CASCADE would have
-- erased the price trail whenever a catalog entity was deleted.
--
-- This migration is deliberately written by hand and is backward-safe:
-- Prisma's generated version DROPs and re-ADDs "entityType", which destroys
-- data. Every statement below preserves existing rows, and the migration
-- aborts loudly rather than guessing at the meaning of a row it cannot
-- classify.

-- CreateEnum
CREATE TYPE "PriceEntityType" AS ENUM ('COMPONENT', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "PriceField" AS ENUM ('SELLING_PRICE', 'PURCHASE_PRICE');

-- DropForeignKey: the two mutually-exclusive FKs on the same polymorphic column.
ALTER TABLE "PriceHistory" DROP CONSTRAINT IF EXISTS "price_history_accessory_fkey";
ALTER TABLE "PriceHistory" DROP CONSTRAINT IF EXISTS "price_history_component_fkey";

-- DropIndex (replaced below by one that also covers createdAt ordering).
DROP INDEX IF EXISTS "PriceHistory_entityType_entityId_idx";

-- AlterTable: additive columns only. "field" is nullable on purpose — a row
-- written before this migration genuinely does not record which price field
-- changed, and backfilling one would invent a fact. The application always
-- sets it on every new row.
ALTER TABLE "PriceHistory"
  ADD COLUMN "entitySku" TEXT,
  ADD COLUMN "entityName" TEXT,
  ADD COLUMN "field" "PriceField",
  ADD COLUMN "adminName" TEXT;

-- Normalize any pre-existing "entityType" text to the enum's spelling,
-- by evidence only: exact case-insensitive match first, then by looking up
-- where the entityId actually lives. Nothing is guessed.
UPDATE "PriceHistory" SET "entityType" = 'COMPONENT' WHERE upper(btrim("entityType")) = 'COMPONENT';
UPDATE "PriceHistory" SET "entityType" = 'ACCESSORY' WHERE upper(btrim("entityType")) = 'ACCESSORY';

UPDATE "PriceHistory" ph SET "entityType" = 'COMPONENT'
 WHERE ph."entityType" NOT IN ('COMPONENT', 'ACCESSORY')
   AND EXISTS (SELECT 1 FROM "Component" c WHERE c."id" = ph."entityId");

UPDATE "PriceHistory" ph SET "entityType" = 'ACCESSORY'
 WHERE ph."entityType" NOT IN ('COMPONENT', 'ACCESSORY')
   AND EXISTS (SELECT 1 FROM "Accessory" a WHERE a."id" = ph."entityId");

DO $$
DECLARE
  unclassified bigint;
BEGIN
  SELECT count(*) INTO unclassified FROM "PriceHistory" WHERE "entityType" NOT IN ('COMPONENT', 'ACCESSORY');
  IF unclassified > 0 THEN
    RAISE EXCEPTION 'PriceHistory: % row(s) have an entityType that is neither COMPONENT nor ACCESSORY and an entityId matching no catalog row. Classify them manually; this migration refuses to guess.', unclassified;
  END IF;
END $$;

-- In-place cast — the column keeps its data, unlike a DROP/ADD.
ALTER TABLE "PriceHistory"
  ALTER COLUMN "entityType" TYPE "PriceEntityType" USING "entityType"::"PriceEntityType";

-- adminId becomes a real FK to User. Detach (do not delete) any row whose
-- admin account no longer exists, so the constraint can be added without
-- dropping audit history; adminName above keeps the actor readable.
UPDATE "PriceHistory" ph SET "adminId" = NULL
 WHERE ph."adminId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = ph."adminId");

-- CreateIndex
CREATE INDEX "PriceHistory_entityType_entityId_createdAt_idx" ON "PriceHistory"("entityType", "entityId", "createdAt");
CREATE INDEX "PriceHistory_adminId_idx" ON "PriceHistory"("adminId");
CREATE INDEX "PriceHistory_createdAt_idx" ON "PriceHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
