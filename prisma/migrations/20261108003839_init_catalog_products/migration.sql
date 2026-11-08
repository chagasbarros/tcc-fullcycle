-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateTable
CREATE TABLE "catalog"."products" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "price_in_cents" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- Same invariants as the Product entity (catalog/domain/product.ts).
-- Prisma does not model CHECK constraints, so they are added by hand here.
ALTER TABLE "catalog"."products"
    ADD CONSTRAINT "products_name_not_blank" CHECK (btrim("name") <> ''),
    ADD CONSTRAINT "products_price_non_negative" CHECK ("price_in_cents" >= 0),
    ADD CONSTRAINT "products_stock_non_negative" CHECK ("stock" >= 0);
