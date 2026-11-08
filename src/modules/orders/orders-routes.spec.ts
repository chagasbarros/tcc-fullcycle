import Fastify, { type FastifyInstance } from 'fastify';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerProblemDetails } from '../../shared/http/problem-details.js';
import { createCatalogModule, InMemoryProductRepository } from '../catalog/index.js';
import { createOrdersModule } from './index.js';
import { InMemoryOrderEventPublisher } from './infrastructure/in-memory-order-event-publisher.js';
import { InMemoryOrderRepository } from './infrastructure/in-memory-order-repository.js';

const CUSTOMER = v7();

/** catalog + orders wired together, talking only through public APIs. */
describe('orders HTTP routes', () => {
  let app: FastifyInstance;
  let events: InMemoryOrderEventPublisher;
  let productId: string;

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
});
