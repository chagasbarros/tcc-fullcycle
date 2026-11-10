import { pino } from 'pino';
// Already loaded by `--import` (same module instance); imported here only for the shutdown.
import { shutdownTracing } from './instrumentation.js';
import { loadEnv } from './shared/config/env.js';
import { createPrismaClient } from './shared/db/prisma.js';
import { createRedisConnection } from './shared/queue/queues.js';
import { startWorker } from './worker-runtime.js';

/** Worker process (ADR-0010): consumes the queues, never serves HTTP. */
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL, name: 'worker' });
const prisma = createPrismaClient(env.DATABASE_URL);
const redis = createRedisConnection(env.REDIS_URL);

const worker = startWorker({ env, prisma, redis, log });

// Graceful shutdown: finish the jobs in progress, then close connections.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info({ signal }, 'shutting down');
    worker
      .close()
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
