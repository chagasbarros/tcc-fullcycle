export type LockOutcome<T> = { acquired: true; result: T } | { acquired: false };

/**
 * Port: a short, NON-blocking mutex per idempotency key (ADR-0016).
 * Two requests with the same key must not run at the same time: the second one would
 * reserve stock before finding out it is a duplicate. runExclusive never waits for the
 * lock: if someone else holds it, it returns { acquired: false } at once.
 */
export interface IdempotencyLock {
  runExclusive<T>(key: string, work: () => Promise<T>): Promise<LockOutcome<T>>;
}
