import { pino } from 'pino';
import { buildApp } from './app.js';
// Already loaded by `--import` (same module instance); imported here only for the shutdown.
import { shutdownTracing } from './instrumentation.js';
import {
  CachedProductRepository,
  createCatalogModule,
  PrismaProductRepository,
} from './modules/catalog/index.js';
import type { OrderPlaced } from './modules/orders/index.js';
import {
  BullMqOrderEventPublisher,
  createOrdersModule,
  PostgresIdempotencyLock,
  PrismaOrderRepository,
} from './modules/orders/index.js';
import { createCacheRedisConnection } from './shared/cache/redis-cache.js';
import { loadEnv } from './shared/config/env.js';
import { createPrismaClient } from './shared/db/prisma.js';
import { createFeatureFlags } from './shared/flags/create-feature-flags.js';
import { Flag } from './shared/flags/feature-flags.js';
import { newId } from './shared/ids.js';
import { createQueue, createRedisConnection, QueueName } from './shared/queue/queues.js';

const env = loadEnv();
// For events outside a request (flags, cache). Request logs use Fastify's logger.
const log = pino({ level: env.LOG_LEVEL, name: 'api' });
const prisma = createPrismaClient(env.DATABASE_URL);
const redis = createRedisConnection(env.REDIS_URL);
// The API only publishes; the worker process consumes (ADR-0010).
const orderPlacedQueue = createQueue<OrderPlaced>(QueueName.ORDER_PLACED, redis);

// Separate, fail-fast connection for the cache (shared/cache/redis-cache.ts).
const cacheRedis = createCacheRedisConnection(env.REDIS_URL);
const flags = createFeatureFlags(env, 'marketplace-api', (error) =>
  log.warn({ err: error }, 'feature flags unavailable, using defaults'),
);

// Composition: this is the only place that decides which implementations are used.
const catalog = createCatalogModule({
  // Cache-aside (ADR-0014) behind the catalog-cache-enabled flag (ADR-0015).
  productRepository: new CachedProductRepository(new PrismaProductRepository(prisma), cacheRedis, {
    isEnabled: () => flags.isEnabled(Flag.CATALOG_CACHE_ENABLED),
    onError: (error) =>
      log.warn({ err: error }, 'catalog cache unavailable, reading from the database'),
  }),
  newId,
});
const orders = createOrdersModule({
  orderRepository: new PrismaOrderRepository(prisma),
  catalog: catalog.api,
  eventPublisher: new BullMqOrderEventPublisher(orderPlacedQueue),
  idempotencyLock: new PostgresIdempotencyLock(prisma),
  newId,
});

const app = await buildApp({ env, catalog, orders });
app.addHook('onClose', async () => {
  await orderPlacedQueue.close();
  flags.close();
  cacheRedis.disconnect();
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
