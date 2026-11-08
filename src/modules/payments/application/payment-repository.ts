import type { Payment } from '../domain/payment.js';

/** Port (Repository pattern, provisional until ADR-0004). */
export interface PaymentRepository {
  findByOrderId(orderId: string): Promise<Payment | null>;
  /**
   * Saves the payment. Returns false (and saves nothing) if the order already has
   * a payment: the unique order_id is the last guard against a double charge record.
   */
  create(payment: Payment): Promise<boolean>;
}
