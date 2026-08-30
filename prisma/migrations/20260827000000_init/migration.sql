-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CONTENT_MANAGER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'CONTACTED', 'APPROVED', 'AWAITING_PAYMENT', 'PAID', 'PRODUCTION', 'READY_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'MANAGER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "previousData" JSONB,
    "newData" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductModel" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameKk" TEXT NOT NULL,
    "shortDescriptionRu" TEXT NOT NULL,
    "shortDescriptionKk" TEXT NOT NULL,
    "descriptionRu" TEXT NOT NULL,
    "descriptionKk" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "gallery" TEXT[],
    "maxLoadKg" INTEGER NOT NULL,
    "loadCapacities" INTEGER[],
    "heights" INTEGER[],
    "widths" INTEGER[],
    "depths" INTEGER[],
    "shelfTypes" TEXT[],
    "minShelves" INTEGER NOT NULL DEFAULT 2,
    "maxShelves" INTEGER NOT NULL DEFAULT 8,
    "useCases" TEXT[],
    "markupPercent" DECIMAL(6,2) NOT NULL DEFAULT 20,
    "markupFixed" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "seoTitle" TEXT NOT NULL,
    "seoDescription" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameKk" TEXT NOT NULL,
    "descriptionRu" TEXT NOT NULL,
    "descriptionKk" TEXT NOT NULL,
    "seoTitle" TEXT NOT NULL,
    "seoDescription" TEXT NOT NULL,
    "height" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL,
    "shelves" INTEGER NOT NULL,
    "sections" INTEGER NOT NULL DEFAULT 1,
    "loadCapacity" INTEGER NOT NULL,
    "shelfType" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "useCases" TEXT[],
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeightOption" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "priceAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 2,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "HeightOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WidthOption" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "priceAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 2,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WidthOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepthOption" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "priceAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 2,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DepthOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoadCapacityOption" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "models" TEXT[],
    "maxWidth" INTEGER NOT NULL,
    "maxDepth" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "noteRu" TEXT,
    "noteKk" TEXT,

    CONSTRAINT "LoadCapacityOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Component" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameKk" TEXT NOT NULL,
    "sellingPrice" DECIMAL(12,2) NOT NULL,
    "purchasePrice" DECIMAL(12,2) NOT NULL,
    "weightKg" DECIMAL(8,2) NOT NULL,
    "height" INTEGER,
    "width" INTEGER,
    "depth" INTEGER,
    "loadCapacity" INTEGER,
    "shelfType" TEXT,
    "variant" TEXT,
    "models" TEXT[],
    "colors" TEXT[],
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 2,
    "supplierRef" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigurationRule" (
    "id" TEXT NOT NULL,
    "modelId" TEXT,
    "componentType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "condition" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigurationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Accessory" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameKk" TEXT NOT NULL,
    "descriptionRu" TEXT NOT NULL,
    "descriptionKk" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "purchasePrice" DECIMAL(12,2) NOT NULL,
    "weightKg" DECIMAL(8,2) NOT NULL,
    "models" TEXT[],
    "maxQuantityPerSection" INTEGER,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accessory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColorOption" (
    "id" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameKk" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "pricePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ColorOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyService" (
    "id" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameKk" TEXT NOT NULL,
    "descriptionRu" TEXT NOT NULL,
    "descriptionKk" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AssemblyService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryMethod" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameKk" TEXT NOT NULL,
    "descriptionRu" TEXT NOT NULL,
    "descriptionKk" TEXT NOT NULL,
    "basePrice" DECIMAL(12,2),
    "requiresAddress" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DeliveryMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "vatPercent" DECIMAL(5,2) NOT NULL DEFAULT 16,
    "pricesIncludeVat" BOOLEAN NOT NULL DEFAULT false,
    "minMarginPercent" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "defaultMarkupPercent" DECIMAL(5,2) NOT NULL DEFAULT 22,
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "priceLevelDiscounts" JSONB NOT NULL,
    "quantityBreaks" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountFixed" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPriceLevel" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerPriceLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" DECIMAL(12,2),
    "newValue" DECIMAL(12,2) NOT NULL,
    "adminId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedConfiguration" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "shareToken" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "priceSnapshot" JSONB NOT NULL,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "email" TEXT,
    "city" TEXT,
    "companyName" TEXT,
    "binIin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "managerId" TEXT,
    "deliveryMethodId" TEXT,
    "deliveryAddress" TEXT,
    "deliveryCity" TEXT,
    "deliveryFloor" TEXT,
    "deliveryHasLift" BOOLEAN,
    "deliveryDate" TIMESTAMP(3),
    "deliveryComment" TEXT,
    "paymentPreference" TEXT NOT NULL,
    "netTotal" DECIMAL(14,2) NOT NULL,
    "vatTotal" DECIMAL(14,2) NOT NULL,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "comment" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "bomSnapshot" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitNetPrice" DECIMAL(14,2) NOT NULL,
    "totalNetPrice" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "note" TEXT,
    "changedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2) NOT NULL,
    "externalId" TEXT,
    "invoiceNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "orderId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "netTotal" DECIMAL(14,2) NOT NULL,
    "vatTotal" DECIMAL(14,2) NOT NULL,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitNetPrice" DECIMAL(14,2) NOT NULL,
    "totalNetPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSetting" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "subject" TEXT,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "relatedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoMetadata" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "titleRu" TEXT NOT NULL,
    "titleKk" TEXT,
    "descriptionRu" TEXT NOT NULL,
    "descriptionKk" TEXT,
    "ogImage" TEXT,

    CONSTRAINT "SeoMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductModel_slug_key" ON "ProductModel"("slug");

-- CreateIndex
CREATE INDEX "ProductModel_active_sortOrder_idx" ON "ProductModel"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_modelId_idx" ON "Product"("modelId");

-- CreateIndex
CREATE INDEX "Product_published_featured_idx" ON "Product"("published", "featured");

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "HeightOption_value_key" ON "HeightOption"("value");

-- CreateIndex
CREATE UNIQUE INDEX "WidthOption_value_key" ON "WidthOption"("value");

-- CreateIndex
CREATE UNIQUE INDEX "DepthOption_value_key" ON "DepthOption"("value");

-- CreateIndex
CREATE UNIQUE INDEX "LoadCapacityOption_value_key" ON "LoadCapacityOption"("value");

-- CreateIndex
CREATE UNIQUE INDEX "Component_sku_key" ON "Component"("sku");

-- CreateIndex
CREATE INDEX "Component_type_active_idx" ON "Component"("type", "active");

-- CreateIndex
CREATE INDEX "ConfigurationRule_componentType_active_idx" ON "ConfigurationRule"("componentType", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Accessory_sku_key" ON "Accessory"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Accessory_slug_key" ON "Accessory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPriceLevel_customerId_key" ON "CustomerPriceLevel"("customerId");

-- CreateIndex
CREATE INDEX "PriceHistory_entityType_entityId_idx" ON "PriceHistory"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedConfiguration_shareToken_key" ON "SavedConfiguration"("shareToken");

-- CreateIndex
CREATE INDEX "SavedConfiguration_shareToken_idx" ON "SavedConfiguration"("shareToken");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_type_key" ON "Customer"("phone", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_idx" ON "OrderStatusHistory"("orderId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_quoteNumber_key" ON "Quote"("quoteNumber");

-- CreateIndex
CREATE INDEX "Quote_orderId_idx" ON "Quote"("orderId");

-- CreateIndex
CREATE INDEX "QuoteItem_quoteId_idx" ON "QuoteItem"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSetting_provider_key" ON "IntegrationSetting"("provider");

-- CreateIndex
CREATE INDEX "IntegrationEvent_provider_createdAt_idx" ON "IntegrationEvent"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_channel_createdAt_idx" ON "NotificationLog"("channel", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeoMetadata_path_key" ON "SeoMetadata"("path");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ProductModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigurationRule" ADD CONSTRAINT "ConfigurationRule_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ProductModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPriceLevel" ADD CONSTRAINT "CustomerPriceLevel_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "price_history_component_fkey" FOREIGN KEY ("entityId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "price_history_accessory_fkey" FOREIGN KEY ("entityId") REFERENCES "Accessory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedConfiguration" ADD CONSTRAINT "SavedConfiguration_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

