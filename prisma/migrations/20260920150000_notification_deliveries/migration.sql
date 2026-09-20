-- Notification delivery outbox. Additive only: creates one new table.
-- No existing table, row, order, snapshot or payment is read or modified, and
-- there is deliberately no foreign key to "Order".
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationDelivery_status_channel_idx" ON "NotificationDelivery"("status", "channel");
CREATE INDEX "NotificationDelivery_orderNumber_idx" ON "NotificationDelivery"("orderNumber");
