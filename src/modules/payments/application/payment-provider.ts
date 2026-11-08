import type { PaymentMethod } from '../domain/payment.js';

export interface ChargeRequest {
  /** Sent to the gateway so a retried charge is not billed twice (ADR-0011). */
  idempotencyKey: string;
  amountInCents: number;
}

export type ChargeResult = { approved: true } | { approved: false; reason: string };

/**
 * Strategy (provisional until ADR-0003): one implementation per payment method,
 * chosen at runtime by ProcessPayment. A new method is a new class; the use case
 * does not change (open/closed principle).
 */
export interface PaymentProvider {
  readonly method: PaymentMethod;
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
