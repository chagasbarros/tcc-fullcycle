import { buildApp } from './app.js';
// Already loaded by `--import` (same module instance); imported here only for the shutdown.
import { shutdownTracing } from './instrumentation.js';
import { createCatalogModule, PrismaProductRepository } from './modules/catalog/index.js';
import type { OrderPlaced } from './modules/orders/index.js';
import {
  BullMqOrderEventPublisher,
  createOrdersModule,
  PrismaOrderRepository,
} from './modules/orders/index.js';
import { loadEnv } from './shared/config/env.js';
import { createPrismaClient } from './shared/db/prisma.js';
import { newId } from './shared/ids.js';
import { createQueue, createRedisConnection, QueueName } from './shared/queue/queues.js';

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const redis = createRedisConnection(env.REDIS_URL);
// The API only publishes; the worker process consumes (ADR-0010).
const orderPlacedQueue = createQueue<OrderPlaced>(QueueName.ORDER_PLACED, redis);

// Composition: this is the only place that decides which implementations are used.
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

const app = await buildApp({ env, catalog, orders });
app.addHook('onClose', async () => {
  await orderPlacedQueue.close();
  redis.disconnect();
  await prisma.$disconnect();
});

// Graceful shutdown: stop accepting requests and finish the in-flight ones.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => shutdownTracing())
      .then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error(error, 'error during shutdown');
          process.exit(1);
        },
      );
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
