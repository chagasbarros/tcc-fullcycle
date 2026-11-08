import type { PaymentResult } from '../../orders/index.js';

/**
 * Port: sends PaymentApproved / PaymentFailed back to orders through the queue.
 * The message shape (PaymentResult) belongs to orders' public API, the consumer.
 */
export interface PaymentResultPublisher {
  publish(result: PaymentResult): Promise<void>;
}
