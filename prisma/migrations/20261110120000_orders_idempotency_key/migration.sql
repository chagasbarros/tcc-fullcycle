-- Idempotency-Key header of POST /orders (ADR-0016).
-- Nullable: existing orders and requests without the header keep NULL.

-- AlterTable
ALTER TABLE "orders"."orders" ADD COLUMN     "idempotency_key" VARCHAR(255);

-- CreateIndex
-- A customer cannot have two orders with the same key, even with concurrent requests.
-- NULLs never collide in a UNIQUE index, so orders without a key are unaffected.
CREATE UNIQUE INDEX "orders_customer_id_idempotency_key_key" ON "orders"."orders"("customer_id", "idempotency_key");

-- Added by hand (Prisma does not generate CHECK constraints): no empty keys.
ALTER TABLE "orders"."orders"
  ADD CONSTRAINT "orders_idempotency_key_not_empty" CHECK ("idempotency_key" IS NULL OR length("idempotency_key") > 0);
