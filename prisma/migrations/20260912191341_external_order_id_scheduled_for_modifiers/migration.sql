-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "modifiers" JSONB;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "external_order_id" TEXT,
ADD COLUMN     "scheduled_for" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "orders_restaurant_id_scheduled_for_idx" ON "orders"("restaurant_id", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "orders_restaurant_id_external_order_id_key" ON "orders"("restaurant_id", "external_order_id");

