-- ADR-0011: orders now record how the customer chose to pay.

-- CreateEnum
CREATE TYPE "orders"."PaymentMethod" AS ENUM ('CARD', 'PIX');

-- Safe for tables that already have rows: existing orders get CARD,
-- then the default is dropped so new orders must always send a method.
ALTER TABLE "orders"."orders"
    ADD COLUMN "payment_method" "orders"."PaymentMethod" NOT NULL DEFAULT 'CARD';
ALTER TABLE "orders"."orders"
    ALTER COLUMN "payment_method" DROP DEFAULT;
