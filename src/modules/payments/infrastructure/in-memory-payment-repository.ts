import type { PaymentRepository } from '../application/payment-repository.js';
import { Payment } from '../domain/payment.js';

/** Repository kept in a Map (keyed by orderId), for unit tests. */
export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly byOrderId = new Map<string, Payment>();

  findByOrderId(orderId: string): Promise<Payment | null> {
    return Promise.resolve(this.byOrderId.get(orderId) ?? null);
  }

  create(payment: Payment): Promise<boolean> {
    if (this.byOrderId.has(payment.orderId)) {
      return Promise.resolve(false);
    }
    this.byOrderId.set(payment.orderId, payment);
    return Promise.resolve(true);
  }

  get count(): number {
    return this.byOrderId.size;
  }
}
