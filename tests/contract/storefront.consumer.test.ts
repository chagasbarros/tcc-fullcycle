import { MatchersV3, PactV4 } from '@pact-foundation/pact';
import { describe, expect, it } from 'vitest';
import {
  CANCELLED_ORDER_ID,
  CONSUMER,
  CUSTOMER_ID,
  MISSING_PRODUCT_ID,
  PACT_DIR,
  PENDING_ORDER_ID,
  PRODUCT_ID,
  PROVIDER,
  State,
} from './fixtures.js';
import { ApiError, StorefrontClient } from './storefront-client.js';

const { like, eachLike, integer, string, uuid, regex, iso8601DateTimeWithMillis, includes } =
  MatchersV3;

/**
 * Consumer side (consumer-driven contract): describes what the storefront needs from
 * the API. Matchers check types/formats, not exact values, so the provider is free to
 * return any valid data. Running this writes tests/contract/pacts/storefront-marketplace-api.json.
 */
const pact = new PactV4({
  consumer: CONSUMER,
  provider: PROVIDER,
  dir: PACT_DIR,
  logLevel: 'warn',
});

const JSON_HEADER = { 'content-type': includes('application/json') };
const PROBLEM_HEADER = { 'content-type': includes('application/problem+json') };

const product = {
  id: uuid(PRODUCT_ID),
  name: string('Keyboard'),
  priceInCents: integer(34_990),
  stock: integer(10),
};

const order = (status: string) => ({
  id: uuid(PENDING_ORDER_ID),
  customerId: uuid(CUSTOMER_ID),
  status: regex('^(PENDING_PAYMENT|PAID|PAYMENT_FAILED|CANCELLED)$', status),
  paymentMethod: regex('^(CARD|PIX)$', 'PIX'),
  totalInCents: integer(69_980),
  createdAt: iso8601DateTimeWithMillis('2026-11-09T12:00:00.000Z'),
  items: eachLike({
    productId: uuid(PRODUCT_ID),
    productName: string('Keyboard'),
    unitPriceInCents: integer(34_990),
    quantity: integer(2),
    subtotalInCents: integer(69_980),
  }),
});

const problem = (status: number, title: string) => ({
  type: string('about:blank'),
  status,
  title: string(title),
});

describe('storefront -> marketplace-api contract (consumer)', () => {
  it('lists products with pagination', () =>
    pact
      .addInteraction()
      .given(State.PRODUCT_EXISTS)
      .uponReceiving('a request for the first page of products')
      .withRequest('GET', '/catalog/products', (b) => b.query({ page: '1', pageSize: '20' }))
      .willRespondWith(200, (b) =>
        b.headers(JSON_HEADER).jsonBody({
          items: eachLike(product),
          page: integer(1),
          pageSize: integer(20),
          total: integer(1),
        }),
      )
      .executeTest(async (mock) => {
        const page = await new StorefrontClient(mock.url).listProducts(1, 20);
        expect(page.items[0]?.priceInCents).toBe(34_990);
      }));

  it('gets a product', () =>
    pact
      .addInteraction()
      .given(State.PRODUCT_EXISTS)
      .uponReceiving('a request for an existing product')
      .withRequest('GET', `/catalog/products/${PRODUCT_ID}`)
      .willRespondWith(200, (b) => b.headers(JSON_HEADER).jsonBody(like(product)))
      .executeTest(async (mock) => {
        const found = await new StorefrontClient(mock.url).getProduct(PRODUCT_ID);
        expect(found.id).toBe(PRODUCT_ID);
      }));

  it('gets 404 Problem Details for a missing product', () =>
    pact
      .addInteraction()
      .given(State.NO_PRODUCT)
      .uponReceiving('a request for a product that does not exist')
      .withRequest('GET', `/catalog/products/${MISSING_PRODUCT_ID}`)
      .willRespondWith(404, (b) => b.headers(PROBLEM_HEADER).jsonBody(problem(404, 'Not Found')))
      .executeTest(async (mock) => {
        await expect(
          new StorefrontClient(mock.url).getProduct(MISSING_PRODUCT_ID),
        ).rejects.toBeInstanceOf(ApiError);
      }));

  it('places an order that waits for payment', () =>
    pact
      .addInteraction()
      .given(State.PRODUCT_EXISTS)
      .uponReceiving('a request to place an order paid with Pix')
      .withRequest('POST', '/orders', (b) =>
        b.headers({ 'content-type': 'application/json' }).jsonBody({
          customerId: CUSTOMER_ID,
          paymentMethod: 'PIX',
          items: [{ productId: PRODUCT_ID, quantity: 2 }],
        }),
      )
      .willRespondWith(201, (b) =>
        b
          .headers({
            ...JSON_HEADER,
            location: regex('^/orders/[0-9a-f-]{36}$', `/orders/${PENDING_ORDER_ID}`),
          })
          .jsonBody(order('PENDING_PAYMENT')),
      )
      .executeTest(async (mock) => {
        const placed = await new StorefrontClient(mock.url).placeOrder({
          customerId: CUSTOMER_ID,
          paymentMethod: 'PIX',
          items: [{ productId: PRODUCT_ID, quantity: 2 }],
        });
        expect(placed.status).toBe('PENDING_PAYMENT');
      }));

  it('gets an order to follow its payment', () =>
    pact
      .addInteraction()
      .given(State.PENDING_ORDER)
      .uponReceiving('a request for an existing order')
      .withRequest('GET', `/orders/${PENDING_ORDER_ID}`)
      .willRespondWith(200, (b) => b.headers(JSON_HEADER).jsonBody(order('PENDING_PAYMENT')))
      .executeTest(async (mock) => {
        const found = await new StorefrontClient(mock.url).getOrder(PENDING_ORDER_ID);
        expect(found.id).toBe(PENDING_ORDER_ID);
      }));

  it('cancels a pending order', () =>
    pact
      .addInteraction()
      .given(State.PENDING_ORDER)
      .uponReceiving('a request to cancel a pending order')
      .withRequest('POST', `/orders/${PENDING_ORDER_ID}/cancel`)
      .willRespondWith(200, (b) => b.headers(JSON_HEADER).jsonBody(order('CANCELLED')))
      .executeTest(async (mock) => {
        const cancelled = await new StorefrontClient(mock.url).cancelOrder(PENDING_ORDER_ID);
        expect(cancelled.status).toBe('CANCELLED');
      }));

  it('gets 409 Problem Details when cancelling an order that is already final', () =>
    pact
      .addInteraction()
      .given(State.CANCELLED_ORDER)
      .uponReceiving('a request to cancel an order that is already cancelled')
      .withRequest('POST', `/orders/${CANCELLED_ORDER_ID}/cancel`)
      .willRespondWith(409, (b) => b.headers(PROBLEM_HEADER).jsonBody(problem(409, 'Conflict')))
      .executeTest(async (mock) => {
        await expect(
          new StorefrontClient(mock.url).cancelOrder(CANCELLED_ORDER_ID),
        ).rejects.toMatchObject({ status: 409 });
      }));
});
