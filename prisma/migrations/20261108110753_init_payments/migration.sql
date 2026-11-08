-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "payments";

-- CreateEnum
CREATE TYPE "payments"."PaymentMethod" AS ENUM ('CARD', 'PIX');

-- CreateEnum
CREATE TYPE "payments"."PaymentStatus" AS ENUM ('APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "payments"."payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" "payments"."PaymentMethod" NOT NULL,
    "amount_in_cents" INTEGER NOT NULL,
    "status" "payments"."PaymentStatus" NOT NULL,
    "decline_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"."payments"("order_id");

-- Same invariants as the Payment entity (payments/domain/payment.ts).
ALTER TABLE "payments"."payments"
    ADD CONSTRAINT "payments_amount_non_negative" CHECK ("amount_in_cents" >= 0),
    ADD CONSTRAINT "payments_approved_without_reason"
        CHECK ("status" <> 'APPROVED' OR "decline_reason" IS NULL);
