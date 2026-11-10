import { Redis } from 'ioredis';

/**
 * Redis connection for caching only, configured to FAIL FAST. The BullMQ connection
 * (shared/queue) waits forever for Redis; a cache must not: if Redis is slow or down,
 * the read goes to the database instead of hanging.
 */
export function createCacheRedisConnection(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false, // while disconnected, commands fail at once instead of queueing
    commandTimeout: 250, // ms: a cache answer slower than this is worse than no cache
  });
}
