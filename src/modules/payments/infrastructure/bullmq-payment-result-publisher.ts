import type { Queue } from 'bullmq';
import type { PaymentResult } from '../../orders/index.js';
import type { PaymentResultPublisher } from '../application/payment-result-publisher.js';

export class BullMqPaymentResultPublisher implements PaymentResultPublisher {
  constructor(private readonly queue: Queue<PaymentResult>) {}

  async publish(result: PaymentResult): Promise<void> {
    const name = result.approved ? 'PaymentApproved' : 'PaymentFailed';
    // jobId = orderId: one result per order; a republished duplicate is dropped by BullMQ.
    await this.queue.add(name, result, { jobId: result.orderId });
  }
}
