import type { PrismaClient } from '../../../shared/db/generated/client.js';
import type { IdempotencyLock, LockOutcome } from '../application/idempotency-lock.js';

/**
 * PostgreSQL advisory lock: works across every API instance, because they share the database.
 * - pg_TRY_advisory_xact_lock does not wait: false means another request holds it.
 *   (A waiting lock could exhaust the connection pool: each waiter holds a connection
 *   while the owner needs another one to finish its work.)
 * - _xact_: released automatically when the transaction ends, even if the process dies.
 * - The key text is hashed to the 64-bit number advisory locks use.
 * The transaction exists only to hold the lock; the work runs on other connections.
 */
export class PostgresIdempotencyLock implements IdempotencyLock {
  constructor(private readonly prisma: PrismaClient) {}

  runExclusive<T>(key: string, work: () => Promise<T>): Promise<LockOutcome<T>> {
    return this.prisma.$transaction(
      async (tx): Promise<LockOutcome<T>> => {
        const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
        if (!row?.locked) return { acquired: false };
        return { acquired: true, result: await work() };
      },
      { timeout: 10_000 }, // upper bound for placing one order while holding the lock
    );
  }
}
