import type { IdempotencyLock, LockOutcome } from '../application/idempotency-lock.js';

/** Lock inside one process: for unit tests (a real deployment uses PostgreSQL). */
export class InMemoryIdempotencyLock implements IdempotencyLock {
  private readonly held = new Set<string>();

  async runExclusive<T>(key: string, work: () => Promise<T>): Promise<LockOutcome<T>> {
    if (this.held.has(key)) return { acquired: false };
    this.held.add(key);
    try {
      return { acquired: true, result: await work() };
    } finally {
      this.held.delete(key);
    }
  }
}
