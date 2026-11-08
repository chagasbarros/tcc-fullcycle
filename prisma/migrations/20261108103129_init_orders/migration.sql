-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "orders";

-- CreateEnum
CREATE TYPE "orders"."OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'PAYMENT_FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "orders"."orders" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "orders"."OrderStatus" NOT NULL,
    "total_in_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders"."order_items" (
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "unit_price_in_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("order_id","product_id")
);

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"."orders"("customer_id");

-- AddForeignKey
ALTER TABLE "orders"."order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same invariants as the Order entity (orders/domain/order.ts).
-- Prisma does not model CHECK constraints, so they are added by hand here.
ALTER TABLE "orders"."orders"
    ADD CONSTRAINT "orders_total_non_negative" CHECK ("total_in_cents" >= 0);

ALTER TABLE "orders"."order_items"
    ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
    ADD CONSTRAINT "order_items_unit_price_non_negative" CHECK ("unit_price_in_cents" >= 0);
