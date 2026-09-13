-- Preserve existing orders. Historical snapshot columns intentionally start
-- nullable: data created before this migration cannot be reconstructed as an
-- original order-time statement. The application blocks formal issuance until
-- an administrator performs a documented, reviewed backfill.

CREATE TYPE "OrderDocumentKind" AS ENUM ('COMMERCIAL_PROPOSAL', 'INVOICE');

ALTER TABLE "Order" ADD COLUMN "buyerSnapshot" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN "documentSnapshot" JSONB;

CREATE TABLE "OrderDocument" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "OrderDocumentKind" NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "sellerSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderDocument_documentNumber_key" ON "OrderDocument"("documentNumber");
CREATE UNIQUE INDEX "OrderDocument_orderId_kind_key" ON "OrderDocument"("orderId", "kind");
CREATE INDEX "OrderDocument_orderId_idx" ON "OrderDocument"("orderId");

ALTER TABLE "OrderDocument"
  ADD CONSTRAINT "OrderDocument_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
