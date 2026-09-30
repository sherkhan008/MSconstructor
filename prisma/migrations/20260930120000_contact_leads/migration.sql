-- Contact-form leads + contact-lead notifications in the existing outbox.
-- Additive only: one new table, one new nullable column and one index on
-- "NotificationDelivery", and "orderNumber" relaxed to nullable (a contact
-- lead delivery has no order). No row is read, rewritten or deleted; every
-- existing delivery keeps its order number. Older app images never write a
-- NULL order number, so an application rollback stays safe.
CREATE TABLE "ContactLead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactLead_createdAt_idx" ON "ContactLead"("createdAt");
CREATE INDEX "ContactLead_phone_createdAt_idx" ON "ContactLead"("phone", "createdAt");

ALTER TABLE "NotificationDelivery" ALTER COLUMN "orderNumber" DROP NOT NULL;
ALTER TABLE "NotificationDelivery" ADD COLUMN "contactLeadId" TEXT;

CREATE INDEX "NotificationDelivery_contactLeadId_idx" ON "NotificationDelivery"("contactLeadId");
