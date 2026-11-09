import { pino } from 'pino';
// Already loaded by `--import` (same module instance); imported here only for the shutdown.
import { shutdownTracing } from './instrumentation.js';
import { createCatalogModule, PrismaProductRepository } from './modules/catalog/index.js';
import {
  BullMqOrderEventPublisher,
  createOrdersModule,
  createPaymentResultsConsumer,
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
import { loadEnv } from './shared/config/env.js';
import { createPrismaClient } from './shared/db/prisma.js';
import { newId } from './shared/ids.js';
import { createQueue, createRedisConnection, QueueName } from './shared/queue/queues.js';

/**
 * Worker process (ADR-0010): consumes the queues, never serves HTTP.
 *   order-placed    -> payments charges the order -> publishes the result
 *   payment-results -> orders marks PAID / PAYMENT_FAILED (and gives stock back)
 */
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL, name: 'worker' });
const prisma = createPrismaClient(env.DATABASE_URL);
const redis = createRedisConnection(env.REDIS_URL);

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

// Graceful shutdown: finish the jobs in progress, then close connections.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info({ signal }, 'shutting down');
    Promise.all(consumers.map((c) => c.close()))
      .then(() => Promise.all([orderPlacedQueue.close(), paymentResultsQueue.close()]))
      .then(() => {
        redis.disconnect();
        return prisma.$disconnect();
      })
      .then(() => shutdownTracing())
      .then(
        () => process.exit(0),
        (error: unknown) => {
          log.error({ err: error }, 'error during shutdown');
          process.exit(1);
        },
      );
  });
}
