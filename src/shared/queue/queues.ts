import { Queue, Worker, type JobsOptions, type Processor } from 'bullmq';
import { BullMQOtel } from 'bullmq-otel';
import { Redis } from 'ioredis';

/** Queue names: the asynchronous contract between modules (CLAUDE.md, section 4). */
export const QueueName = {
  /** orders -> payments */
  ORDER_PLACED: 'order-placed',
  /** payments -> orders (PaymentApproved / PaymentFailed) */
  PAYMENT_RESULTS: 'payment-results',
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];

/**
 * Retry policy for every job: 5 attempts with exponential backoff (1s, 2s, 4s, 8s).
 * Finished jobs are kept for a while so the same jobId is rejected as a duplicate.
 */
const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/**
 * Trace propagation across the queue: the producer writes the current trace context into
 * the job, and the worker continues the same trace (POST /orders -> worker in one trace).
 * Without the OTel SDK started (tests, no Jaeger), this is a no-op.
 */
const telemetry = new BullMQOtel({ tracerName: 'bullmq' });

export function createRedisConnection(url: string): Redis {
  // BullMQ requires maxRetriesPerRequest: null (blocking commands must not time out).
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createQueue<T>(name: QueueName, connection: Redis): Queue<T> {
  return new Queue<T>(name, { connection, defaultJobOptions, telemetry });
}

export function createWorker<T>(
  name: QueueName,
  processor: Processor<T>,
  connection: Redis,
  concurrency = 10,
): Worker<T> {
  return new Worker<T>(name, processor, { connection, concurrency, telemetry });
}
