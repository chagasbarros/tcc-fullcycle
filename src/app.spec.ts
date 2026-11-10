import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createCatalogModule, InMemoryProductRepository } from './modules/catalog/index.js';
import {
  createOrdersModule,
  InMemoryIdempotencyLock,
  InMemoryOrderEventPublisher,
  InMemoryOrderRepository,
} from './modules/orders/index.js';

describe('app', () => {
  let app: FastifyInstance;

  const build = (env: Parameters<typeof buildApp>[0]['env']) => {
    const catalog = createCatalogModule({
      productRepository: new InMemoryProductRepository(),
      newId: () => 'unused',
    });
    return buildApp({
      env,
      catalog,
      orders: createOrdersModule({
        orderRepository: new InMemoryOrderRepository(),
        catalog: catalog.api,
        eventPublisher: new InMemoryOrderEventPublisher(),
        idempotencyLock: new InMemoryIdempotencyLock(),
        newId: () => 'unused',
      }),
    });
  };

  beforeAll(async () => {
    app = await build({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health answers 200 with status ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: null });
  });

  it('GET /health reports the deployed commit when Render sets it', async () => {
    const deployed = await build({
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      RENDER_GIT_COMMIT: 'a39955b0c1d2e3f4',
    });

    const response = await deployed.inject({ method: 'GET', url: '/health' });
    await deployed.close();

    expect(response.json()).toEqual({ status: 'ok', version: 'a39955b0c1d2e3f4' });
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

  describe('x-request-id', () => {
    it('generates a UUID v7 when the client sends none', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('reuses a safe id sent by the client, also on error responses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/nope',
        headers: { 'x-request-id': 'checkout-42.abc_DEF' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['x-request-id']).toBe('checkout-42.abc_DEF');
    });

    it.each([
      ['too long', 'a'.repeat(65)],
      ['with spaces or line breaks', 'fake\nlog line'],
      ['with JSON characters', '{"level":50}'],
    ])('replaces an unsafe id (%s)', async (_case, unsafe) => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': unsafe },
      });

      expect(response.headers['x-request-id']).not.toBe(unsafe);
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('exposes RED metrics labelled by route template, not by raw URL', async () => {
    await app.inject({ method: 'GET', url: '/orders/01900000-0000-7000-8000-000000000001' });
    await app.inject({ method: 'GET', url: '/random/url/123' });

    const response = await app.inject({ method: 'GET', url: '/metrics' });
    const body = response.body;

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(body).toContain(
      'http_request_duration_seconds_count{method="GET",route="/orders/:id",status_code="404"} 1',
    );
    expect(body).toContain('route="unmatched",status_code="404"');
    expect(body).not.toContain('01900000-0000-7000-8000-000000000001');
    expect(body).not.toContain('route="/metrics"');
    expect(body).toContain('nodejs_eventloop_lag_seconds');
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
