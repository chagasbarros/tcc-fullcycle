import { resolve } from 'node:path';
import { Verifier } from '@pact-foundation/pact';
import type { FastifyInstance } from 'fastify';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { Product } from '../../src/modules/catalog/domain/product.js';
import {
  createCatalogModule,
  InMemoryProductRepository,
  type ProductRepository,
} from '../../src/modules/catalog/index.js';
import { Order } from '../../src/modules/orders/domain/order.js';
import {
  createOrdersModule,
  InMemoryIdempotencyLock,
  InMemoryOrderEventPublisher,
  InMemoryOrderRepository,
  type OrderRepository,
} from '../../src/modules/orders/index.js';
import {
  CANCELLED_ORDER_ID,
  CONSUMER,
  CUSTOMER_ID,
  PACT_DIR,
  PENDING_ORDER_ID,
  PRODUCT_ID,
  PROVIDER,
  State,
} from './fixtures.js';

/**
 * Provider side: runs the real HTTP app (routes, validation, error handling, use cases)
 * with in-memory repositories, and replays every interaction of the consumer's pact.
 * If a route changes in a way the storefront would notice, this test fails.
 */

// Each provider state starts from empty repositories. The app keeps a reference to
// these small delegates, which forward to whatever repository is current.
let products = new InMemoryProductRepository();
let orders = new InMemoryOrderRepository();

const productRepository: ProductRepository = {
  save: (p) => products.save(p),
  findById: (id) => products.findById(id),
  findManyByIds: (ids) => products.findManyByIds(ids),
  list: (params) => products.list(params),
  reserveStock: (items) => products.reserveStock(items),
  releaseStock: (items) => products.releaseStock(items),
};
const orderRepository: OrderRepository = {
  create: (o) => orders.create(o),
  findById: (id) => orders.findById(id),
  findByIdempotencyKey: (customerId, key) => orders.findByIdempotencyKey(customerId, key),
  updateStatus: (o, expected) => orders.updateStatus(o, expected),
};

function reset(): void {
  products = new InMemoryProductRepository();
  orders = new InMemoryOrderRepository();
}

const keyboard = () =>
  Product.create({ id: PRODUCT_ID, name: 'Keyboard', priceInCents: 34_990, stock: 10 });

const pendingOrder = (id: string) =>
  Order.place({
    id,
    customerId: CUSTOMER_ID,
    paymentMethod: 'PIX',
    createdAt: new Date('2026-11-09T12:00:00.000Z'),
    items: [
      { productId: PRODUCT_ID, productName: 'Keyboard', unitPriceInCents: 34_990, quantity: 2 },
    ],
  });

const stateHandlers = {
  [State.PRODUCT_EXISTS]: async () => {
    reset();
    await products.save(keyboard());
  },
  [State.NO_PRODUCT]: () => {
    reset();
    return Promise.resolve();
  },
  [State.PENDING_ORDER]: async () => {
    reset();
    await products.save(keyboard());
    await orders.create(pendingOrder(PENDING_ORDER_ID));
  },
  [State.CANCELLED_ORDER]: async () => {
    reset();
    const order = pendingOrder(CANCELLED_ORDER_ID);
    await orders.create(order);
    order.cancel();
    await orders.updateStatus(order, 'PENDING_PAYMENT');
  },
};

describe('marketplace-api honours the storefront contract (provider)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    const catalog = createCatalogModule({ productRepository, newId: v7 });
    app = await buildApp({
      env: { NODE_ENV: 'test', LOG_LEVEL: 'info' },
      catalog,
      orders: createOrdersModule({
        orderRepository,
        catalog: catalog.api,
        eventPublisher: new InMemoryOrderEventPublisher(),
        idempotencyLock: new InMemoryIdempotencyLock(),
        newId: v7,
      }),
    });
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(() => app.close());

  it('verifies every interaction in the pact', async () => {
    await new Verifier({
      provider: PROVIDER,
      providerBaseUrl: baseUrl,
      pactUrls: [resolve(PACT_DIR, `${CONSUMER}-${PROVIDER}.json`)],
      stateHandlers,
      logLevel: 'warn',
    }).verifyProvider();
  });
});
