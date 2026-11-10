import { v7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createCatalogModule, PrismaProductRepository } from '../../src/modules/catalog/index.js';
import { Order } from '../../src/modules/orders/domain/order.js';
import {
  createOrdersModule,
  InMemoryOrderEventPublisher,
  PostgresIdempotencyLock,
  PrismaOrderRepository,
} from '../../src/modules/orders/index.js';
import { buildApp } from '../../src/app.js';
import { testPrisma, truncateAll } from './helpers.js';

/** Idempotency-Key (ADR-0016) against the real UNIQUE(customer_id, idempotency_key). */
describe('Idempotency-Key (PostgreSQL)', () => {
  const prisma = testPrisma();
  const repository = new PrismaOrderRepository(prisma);

  beforeEach(() => truncateAll(prisma));
  afterAll(() => prisma.$disconnect());

  const orderWithKey = (customerId: string, idempotencyKey: string) =>
    Order.place({
      id: v7(),
      customerId,
      paymentMethod: 'CARD',
      createdAt: new Date(),
      items: [{ productId: v7(), productName: 'Keyboard', unitPriceInCents: 34_990, quantity: 1 }],
      idempotencyKey,
    });

  it('repository: a second order with the same key for the same customer is refused, not thrown', async () => {
    const customer = v7();
    const first = orderWithKey(customer, 'checkout-1');

    expect(await repository.create(first)).toBe(true);
    expect(await repository.create(orderWithKey(customer, 'checkout-1'))).toBe(false);
    expect(await repository.create(orderWithKey(v7(), 'checkout-1'))).toBe(true); // other customer
    expect((await repository.findByIdempotencyKey(customer, 'checkout-1'))?.id).toBe(first.id);
    expect(await repository.findByIdempotencyKey(customer, 'unknown')).toBeNull();
  });

  it.each([
    ['plenty of stock', 100],
    ['stock for exactly one order', 3],
  ])(
    '10 concurrent POST /orders with the same key (%s): 1 order, stock reserved once, never out-of-stock',
    async (_case, initialStock) => {
      const events = new InMemoryOrderEventPublisher();
      const catalog = createCatalogModule({
        productRepository: new PrismaProductRepository(prisma),
        newId: v7,
      });
      const app = await buildApp({
        env: { NODE_ENV: 'test', LOG_LEVEL: 'info' },
        catalog,
        orders: createOrdersModule({
          orderRepository: repository,
          catalog: catalog.api,
          eventPublisher: events,
          idempotencyLock: new PostgresIdempotencyLock(prisma),
          newId: v7,
        }),
      });
      const product = await app.inject({
        method: 'POST',
        url: '/catalog/products',
        payload: { name: 'Keyboard', priceInCents: 34_990, stock: initialStock },
      });
      const productId = product.json<{ id: string }>().id;
      const customerId = v7();

      const send = () =>
        app.inject({
          method: 'POST',
          url: '/orders',
          headers: { 'idempotency-key': 'double-click' },
          payload: { customerId, paymentMethod: 'CARD', items: [{ productId, quantity: 3 }] },
        });

      const responses = await Promise.all(Array.from({ length: 10 }, send));
      const created = responses.filter((r) => r.statusCode === 201);
      const busy = responses.filter((r) => r.statusCode === 409);

      // Each answer is either the order or "in progress, retry" - never "out of stock".
      expect(created.length + busy.length).toBe(10);
      expect(created.length).toBeGreaterThanOrEqual(1);
      expect(new Set(created.map((r) => r.json<{ id: string }>().id)).size).toBe(1);
      for (const r of busy) {
        expect(r.headers['retry-after']).toBe('1');
        expect(r.json<{ detail: string }>().detail).toContain('in progress');
      }
      expect(await prisma.order.count({ where: { customerId } })).toBe(1);
      expect((await prisma.product.findUnique({ where: { id: productId } }))?.stock).toBe(
        initialStock - 3,
      );
      expect(events.published).toHaveLength(1);

      // The client retries after Retry-After: it gets the same order, flagged as a replay.
      const retry = await send();
      await app.close();
      expect(retry.statusCode).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json<{ id: string }>().id).toBe(created[0]?.json<{ id: string }>().id);
      console.info(
        `[${_case}] 10 concurrent: ${created.length} x 201, ${busy.length} x 409 in progress`,
      );
    },
  );
});
