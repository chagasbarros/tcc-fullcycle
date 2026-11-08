import type { PaymentResult } from '../../orders/index.js';
import type { PaymentResultPublisher } from '../application/payment-result-publisher.js';

/** Keeps published results in a list, for unit tests. */
export class InMemoryPaymentResultPublisher implements PaymentResultPublisher {
  readonly published: PaymentResult[] = [];

  publish(result: PaymentResult): Promise<void> {
    this.published.push(result);
    return Promise.resolve();
  }
}
