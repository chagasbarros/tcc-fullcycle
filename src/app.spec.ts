import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createCatalogModule, InMemoryProductRepository } from './modules/catalog/index.js';
import {
  createOrdersModule,
  InMemoryOrderEventPublisher,
  InMemoryOrderRepository,
} from './modules/orders/index.js';

describe('app', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const catalog = createCatalogModule({
      productRepository: new InMemoryProductRepository(),
      newId: () => 'unused',
    });
    app = await buildApp({
      env: { NODE_ENV: 'test', LOG_LEVEL: 'info' },
      catalog,
      orders: createOrdersModule({
        orderRepository: new InMemoryOrderRepository(),
        catalog: catalog.api,
        eventPublisher: new InMemoryOrderEventPublisher(),
        newId: () => 'unused',
      }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health answers 200 with status ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('serves the hand-written OpenAPI contract and the Swagger UI at /docs', async () => {
    const spec = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(spec.statusCode).toBe(200);
    expect(spec.json()).toMatchObject({ openapi: '3.1.0', info: { title: 'Marketplace API' } });
    expect(Object.keys(spec.json<{ paths: object }>().paths)).toContain('/orders');

    const ui = await app.inject({ method: 'GET', url: '/docs/' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
  });

  it('answers unknown routes with 404 Problem Details', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 404, title: 'Not Found', instance: '/nope' });
  });

  it('answers malformed JSON with 400 Problem Details', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/catalog/products',
      headers: { 'content-type': 'application/json' },
      payload: '{bad json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });
});
