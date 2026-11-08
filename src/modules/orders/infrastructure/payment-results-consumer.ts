import type { Redis } from 'ioredis';
import { z } from 'zod';
import { createWorker, QueueName } from '../../../shared/queue/queues.js';
import type {
  ApplyPaymentResultOutcome,
  PaymentResult,
} from '../application/apply-payment-result.js';

const paymentResultSchema = z.object({
  orderId: z.uuid(),
  approved: z.boolean(),
});

/**
 * Consumes PaymentApproved / PaymentFailed. A thrown error makes BullMQ retry the job
 * (see the retry policy in shared/queue); ApplyPaymentResult is idempotent, so retries are safe.
 */
export function createPaymentResultsConsumer(
  connection: Redis,
  applyPaymentResult: (result: PaymentResult) => Promise<ApplyPaymentResultOutcome>,
) {
  return createWorker<PaymentResult>(
    QueueName.PAYMENT_RESULTS,
    (job) => applyPaymentResult(paymentResultSchema.parse(job.data)),
    connection,
  );
}
