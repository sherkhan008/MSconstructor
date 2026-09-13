-- Who issued an OrderDocument. Applied on top of 20260913000000_order_document_snapshots.
-- "OrderDocument" has no rows before the issuance code ships (the table is created by the
-- previous migration and nothing writes it until this release), so the NOT NULL column is
-- safe to add without a default. The issuer's name is kept even if the account is removed.

-- AlterTable
ALTER TABLE "OrderDocument" ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "issuedByName" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "OrderDocument" ADD CONSTRAINT "OrderDocument_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
