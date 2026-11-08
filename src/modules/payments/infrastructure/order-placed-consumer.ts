import type { Redis } from 'ioredis';
import { z } from 'zod';
import { createWorker, QueueName } from '../../../shared/queue/queues.js';
import type { OrderPlaced } from '../../orders/index.js';
import type { ProcessPaymentOutcome } from '../application/process-payment.js';

const orderPlacedSchema = z.object({
  orderId: z.uuid(),
  customerId: z.uuid(),
  totalInCents: z.number().int().min(0),
  paymentMethod: z.enum(['CARD', 'PIX']),
});

/**
 * Consumes OrderPlaced. A thrown error makes BullMQ retry the job; ProcessPayment
 * checks for an existing payment first, so a retry never charges twice.
 */
export function createOrderPlacedConsumer(
  connection: Redis,
  processPayment: (event: OrderPlaced) => Promise<ProcessPaymentOutcome>,
) {
  return createWorker<OrderPlaced>(
    QueueName.ORDER_PLACED,
    (job) => processPayment(orderPlacedSchema.parse(job.data)),
    connection,
  );
}
