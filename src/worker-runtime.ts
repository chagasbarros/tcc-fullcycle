import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { createCatalogModule, PrismaProductRepository } from './modules/catalog/index.js';
import {
  BullMqOrderEventPublisher,
  createOrdersModule,
  createPaymentResultsConsumer,
  PostgresIdempotencyLock,
  PrismaOrderRepository,
  type OrderPlaced,
  type PaymentResult,
} from './modules/orders/index.js';
import {
  BullMqPaymentResultPublisher,
  createOrderPlacedConsumer,
  createPaymentsModule,
  FakeCardProvider,
  FakePixProvider,
  PrismaPaymentRepository,
} from './modules/payments/index.js';
import type { Env } from './shared/config/env.js';
import type { PrismaClient } from './shared/db/generated/client.js';
import { newId } from './shared/ids.js';
import { createQueue, QueueName } from './shared/queue/queues.js';

export interface WorkerDeps {
  env: Pick<Env, 'PAYMENT_PROVIDER_LATENCY_MS'>;
  prisma: PrismaClient;
  /** A BullMQ-ready connection (maxRetriesPerRequest: null). */
  redis: Redis;
  log: Logger;
}

export interface RunningWorker {
  /** Finishes the jobs in progress and closes the queues. Connections stay with the caller. */
  close(): Promise<void>;
}

/**
 * Queue consumers (ADR-0010):
 *   order-placed    -> payments charges the order -> publishes the result
 *   payment-results -> orders marks PAID / PAYMENT_FAILED (and gives stock back)
 * Started by src/worker.ts (its own process, locally) or inside the API process when
 * RUN_WORKER_IN_PROCESS=true (Render free plan, ADR-0018). Same code either way.
 */
export function startWorker({ env, prisma, redis, log }: WorkerDeps): RunningWorker {
  const orderPlacedQueue = createQueue<OrderPlaced>(QueueName.ORDER_PLACED, redis);
  const paymentResultsQueue = createQueue<PaymentResult>(QueueName.PAYMENT_RESULTS, redis);

  // Composition: same modules as the API, wired for queue processing.
  const catalog = createCatalogModule({
    productRepository: new PrismaProductRepository(prisma),
    newId,
  });
  const orders = createOrdersModule({
    orderRepository: new PrismaOrderRepository(prisma),
    catalog: catalog.api,
    eventPublisher: new BullMqOrderEventPublisher(orderPlacedQueue),
    idempotencyLock: new PostgresIdempotencyLock(prisma),
    newId,
  });
  const payments = createPaymentsModule({
    paymentRepository: new PrismaPaymentRepository(prisma),
    providers: [
      new FakeCardProvider(env.PAYMENT_PROVIDER_LATENCY_MS),
      new FakePixProvider(env.PAYMENT_PROVIDER_LATENCY_MS),
    ],
    resultPublisher: new BullMqPaymentResultPublisher(paymentResultsQueue),
    newId,
  });

  const consumers = [
    createOrderPlacedConsumer(redis, (event) => payments.processPayment(event)),
    createPaymentResultsConsumer(redis, (result) => orders.applyPaymentResult(result)),
  ];

  for (const consumer of consumers) {
    consumer.on('completed', (job, outcome) =>
      log.info({ queue: consumer.name, jobId: job.id, outcome }, 'job completed'),
    );
    consumer.on('failed', (job, error) =>
      log.warn(
        { queue: consumer.name, jobId: job?.id, attempt: job?.attemptsMade, err: error },
        'job failed',
      ),
    );
  }
  log.info({ queues: consumers.map((c) => c.name) }, 'worker started');

  return {
    async close() {
      await Promise.all(consumers.map((c) => c.close()));
      await Promise.all([orderPlacedQueue.close(), paymentResultsQueue.close()]);
    },
  };
}
