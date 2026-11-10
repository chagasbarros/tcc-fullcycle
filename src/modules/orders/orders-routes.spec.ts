import Fastify, { type FastifyInstance } from 'fastify';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerProblemDetails } from '../../shared/http/problem-details.js';
import { createCatalogModule, InMemoryProductRepository } from '../catalog/index.js';
import { createOrdersModule } from './index.js';
import { InMemoryIdempotencyLock } from './infrastructure/in-memory-idempotency-lock.js';
import { InMemoryOrderEventPublisher } from './infrastructure/in-memory-order-event-publisher.js';
import { InMemoryOrderRepository } from './infrastructure/in-memory-order-repository.js';

const CUSTOMER = v7();

/** catalog + orders wired together, talking only through public APIs. */
describe('orders HTTP routes', () => {
  let app: FastifyInstance;
  let events: InMemoryOrderEventPublisher;
  let productId: string;
  const lock = new InMemoryIdempotencyLock();

  beforeAll(async () => {
    const catalog = createCatalogModule({
      productRepository: new InMemoryProductRepository(),
      newId: v7,
    });
    events = new InMemoryOrderEventPublisher();
    const orders = createOrdersModule({
      orderRepository: new InMemoryOrderRepository(),
      catalog: catalog.api,
      eventPublisher: events,
      idempotencyLock: lock,
      newId: v7,
    });

    app = Fastify();
    registerProblemDetails(app);
    await app.register(catalog.routes, { prefix: '/catalog' });
    await app.register(orders.routes, { prefix: '/orders' });

    const created = await app.inject({
      method: 'POST',
      url: '/catalog/products',
      payload: { name: 'Keyboard', priceInCents: 34_990, stock: 10 },
    });
    productId = created.json<{ id: string }>().id;
  });

  afterAll(() => app.close());

  const stock = async () =>
    (await app.inject({ method: 'GET', url: `/catalog/products/${productId}` })).json<{
      stock: number;
    }>().stock;

  const place = (quantity: number) =>
    app.inject({
      method: 'POST',
      url: '/orders',
      payload: { customerId: CUSTOMER, paymentMethod: 'CARD', items: [{ productId, quantity }] },
    });

  it('POST /orders creates a pending order, reserves stock and publishes OrderPlaced', async () => {
    const response = await place(2);

    expect(response.statusCode).toBe(201);
    const order = response.json<{ id: string }>();
    expect(response.headers.location).toBe(`/orders/${order.id}`);
    expect(order).toMatchObject({
      customerId: CUSTOMER,
      paymentMethod: 'CARD',
      status: 'PENDING_PAYMENT',
      totalInCents: 69_980,
      items: [
        {
          productId,
          productName: 'Keyboard',
          unitPriceInCents: 34_990,
          quantity: 2,
          subtotalInCents: 69_980,
        },
      ],
    });
    expect(await stock()).toBe(8);
    expect(events.published.at(-1)).toEqual({
      orderId: order.id,
      customerId: CUSTOMER,
      paymentMethod: 'CARD',
      totalInCents: 69_980,
    });
  });

  it('GET /orders/:id returns the order', async () => {
    const { id } = (await place(1)).json<{ id: string }>();

    const response = await app.inject({ method: 'GET', url: `/orders/${id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, status: 'PENDING_PAYMENT' });
  });

  it('POST /orders answers 409 when there is not enough stock', async () => {
    const response = await place(100);

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it.each([
    ['no Content-Type', {}],
    ['an unknown Content-Type', { 'content-type': 'application/octet-stream' }],
  ])(
    'POST /orders/:id/cancel ignores a stray body with %s (was 415, found by Pact)',
    async (_case, headers) => {
      const { id } = (await place(1)).json<{ id: string }>();

      const response = await app.inject({
        method: 'POST',
        url: `/orders/${id}/cancel`,
        headers,
        payload: 'ignored',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'CANCELLED' });
    },
  );

  it('POST /orders/:id/cancel cancels and gives stock back; a second cancel is 409', async () => {
    const before = await stock();
    const { id } = (await place(1)).json<{ id: string }>();
    expect(await stock()).toBe(before - 1);

    const cancelled = await app.inject({ method: 'POST', url: `/orders/${id}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED' });
    expect(await stock()).toBe(before);

    const again = await app.inject({ method: 'POST', url: `/orders/${id}/cancel` });
    expect(again.statusCode).toBe(409);
  });

  it('POST /orders answers 422 for a product that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        customerId: CUSTOMER,
        paymentMethod: 'CARD',
        items: [{ productId: v7(), quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('GET /orders/:id answers 404 for an unknown order', async () => {
    const response = await app.inject({ method: 'GET', url: `/orders/${v7()}` });
    expect(response.statusCode).toBe(404);
  });

  it.each([
    { name: 'missing customerId', payload: { items: [{ productId: v7(), quantity: 1 }] } },
    {
      name: 'unknown paymentMethod',
      payload: {
        customerId: CUSTOMER,
        paymentMethod: 'BOLETO',
        items: [{ productId: v7(), quantity: 1 }],
      },
    },
    { name: 'empty items', payload: { customerId: CUSTOMER, paymentMethod: 'CARD', items: [] } },
    {
      name: 'zero quantity',
      payload: {
        customerId: CUSTOMER,
        paymentMethod: 'CARD',
        items: [{ productId: v7(), quantity: 0 }],
      },
    },
  ])('POST /orders answers 400 for $name', async ({ payload }) => {
    const response = await app.inject({ method: 'POST', url: '/orders', payload });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: 400, title: 'Bad Request' });
  });

  describe('Idempotency-Key header (ADR-0016)', () => {
    const placeWithKey = (key: string, quantity = 1) =>
      app.inject({
        method: 'POST',
        url: '/orders',
        headers: { 'idempotency-key': key },
        payload: { customerId: CUSTOMER, paymentMethod: 'PIX', items: [{ productId, quantity }] },
      });

    it('a retry answers 201 with the same order, flagged as a replay, without reserving again', async () => {
      const before = await stock();
      const published = events.published.length;

      const first = await placeWithKey('retry-me');
      const retry = await placeWithKey('retry-me');

      expect(first.statusCode).toBe(201);
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(retry.statusCode).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
      expect(retry.headers.location).toBe(first.headers.location);
      expect(await stock()).toBe(before - 1);
      expect(events.published).toHaveLength(published + 1);
    });

    it('the same key for a different order answers 422 Problem Details', async () => {
      await placeWithKey('reused-key', 1);

      const response = await placeWithKey('reused-key', 2);

      expect(response.statusCode).toBe(422);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json<{ detail: string }>().detail).toContain('reused-key');
    });

    it('while another request holds the key: 409 + Retry-After, nothing reserved; afterwards it works', async () => {
      const before = await stock();

      const busy = await lock.runExclusive(`${CUSTOMER}:in-flight`, () =>
        placeWithKey('in-flight'),
      );

      expect(busy).toMatchObject({ acquired: true });
      const response = busy.acquired ? busy.result : undefined;
      expect(response?.statusCode).toBe(409);
      expect(response?.headers['retry-after']).toBe('1');
      expect(response?.json<{ detail: string }>().detail).toContain('in progress');
      expect(await stock()).toBe(before);

      expect((await placeWithKey('in-flight')).statusCode).toBe(201);
    });

    it.each([
      ['too long', 'k'.repeat(256)],
      ['with spaces', 'two words'],
    ])('an invalid key (%s) answers 400', async (_case, key) => {
      const response = await placeWithKey(key);

      expect(response.statusCode).toBe(400);
      expect(response.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe(
        'idempotency-key',
      );
    });
  });
});
