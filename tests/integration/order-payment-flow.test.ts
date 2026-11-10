import { QueueEvents } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { v7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createCatalogModule, PrismaProductRepository } from '../../src/modules/catalog/index.js';
import {
  BullMqOrderEventPublisher,
  createOrdersModule,
  createPaymentResultsConsumer,
  PostgresIdempotencyLock,
  PrismaOrderRepository,
  type OrderPlaced,
  type PaymentResult,
} from '../../src/modules/orders/index.js';
import {
  BullMqPaymentResultPublisher,
  createOrderPlacedConsumer,
  createPaymentsModule,
  FakeCardProvider,
  FakePixProvider,
  PrismaPaymentRepository,
} from '../../src/modules/payments/index.js';
import { createQueue, createRedisConnection, QueueName } from '../../src/shared/queue/queues.js';
import { testPrisma, truncateAll } from './helpers.js';

/**
 * The whole asynchronous flow with real infrastructure:
 *   POST /orders -> order-placed queue -> payments -> payment-results queue -> orders
 * API and consumers are wired exactly like src/server.ts and src/worker.ts.
 */
describe('order -> queue -> payment -> order (PostgreSQL + Redis)', () => {
  const prisma = testPrisma();
  const redis = createRedisConnection(inject('redisUrl'));
  const orderPlacedQueue = createQueue<OrderPlaced>(QueueName.ORDER_PLACED, redis);
  const paymentResultsQueue = createQueue<PaymentResult>(QueueName.PAYMENT_RESULTS, redis);

  const catalog = createCatalogModule({
    productRepository: new PrismaProductRepository(prisma),
    newId: v7,
  });
  const orders = createOrdersModule({
    orderRepository: new PrismaOrderRepository(prisma),
    catalog: catalog.api,
    eventPublisher: new BullMqOrderEventPublisher(orderPlacedQueue),
    idempotencyLock: new PostgresIdempotencyLock(prisma),
    newId: v7,
  });
  const payments = createPaymentsModule({
    paymentRepository: new PrismaPaymentRepository(prisma),
    providers: [new FakeCardProvider(), new FakePixProvider()],
    resultPublisher: new BullMqPaymentResultPublisher(paymentResultsQueue),
    newId: v7,
  });
  const consumers = [
    createOrderPlacedConsumer(redis, (event) => payments.processPayment(event)),
    createPaymentResultsConsumer(redis, (result) => orders.applyPaymentResult(result)),
  ];

  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ env: { NODE_ENV: 'test', LOG_LEVEL: 'info' }, catalog, orders });
  });
  beforeEach(() => truncateAll(prisma));
  afterAll(async () => {
    await app.close();
    await Promise.all(consumers.map((c) => c.close()));
    await Promise.all([orderPlacedQueue.close(), paymentResultsQueue.close()]);
    redis.disconnect();
    await prisma.$disconnect();
  });

  async function createProduct(priceInCents: number, stock: number): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/catalog/products',
      payload: { name: 'Product', priceInCents, stock },
    });
    return response.json<{ id: string }>().id;
  }

  async function placeOrder(productId: string, paymentMethod: 'CARD' | 'PIX') {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { customerId: v7(), paymentMethod, items: [{ productId, quantity: 1 }] },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ id: string; status: string }>();
  }

  /** Polls GET /orders/:id until the worker has moved the order out of PENDING_PAYMENT. */
  async function waitForFinalStatus(orderId: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { status } = (await app.inject({ method: 'GET', url: `/orders/${orderId}` })).json<{
        status: string;
      }>();
      if (status !== 'PENDING_PAYMENT') return status;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`order ${orderId} is still PENDING_PAYMENT after 10 s`);
  }

  const stockOf = async (productId: string) =>
    (await app.inject({ method: 'GET', url: `/catalog/products/${productId}` })).json<{
      stock: number;
    }>().stock;

  it('card payment approved: order becomes PAID and stock stays reserved', async () => {
    const productId = await createProduct(10_000, 5);

    const order = await placeOrder(productId, 'CARD');

    expect(order.status).toBe('PENDING_PAYMENT');
    expect(await waitForFinalStatus(order.id)).toBe('PAID');
    expect(await stockOf(productId)).toBe(4);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('card declined (amount ends in 13 cents): PAYMENT_FAILED and stock is given back', async () => {
    const productId = await createProduct(1_013, 5);

    const order = await placeOrder(productId, 'CARD');

    expect(await waitForFinalStatus(order.id)).toBe('PAYMENT_FAILED');
    expect(await stockOf(productId)).toBe(5);
  });

  it('same amount with Pix: the Strategy picks the Pix provider, which approves', async () => {
    const productId = await createProduct(1_013, 5);

    const order = await placeOrder(productId, 'PIX');

    expect(await waitForFinalStatus(order.id)).toBe('PAID');
  });

  it('a redelivered OrderPlaced (different jobId) does not charge again', async () => {
    const productId = await createProduct(1_013, 5);
    const order = await placeOrder(productId, 'CARD');
    expect(await waitForFinalStatus(order.id)).toBe('PAYMENT_FAILED');

    const job = await orderPlacedQueue.getJob(order.id);
    const redelivery = await orderPlacedQueue.add('OrderPlaced', job!.data, {
      jobId: `redelivery-${order.id}`,
    });
    const events = new QueueEvents(QueueName.ORDER_PLACED, {
      connection: createRedisConnection(inject('redisUrl')),
    });
    const outcome: unknown = await redelivery.waitUntilFinished(events);
    await events.close();

    expect(outcome).toBe('duplicate');
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await stockOf(productId)).toBe(5); // not given back twice
  });
});
