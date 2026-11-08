import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerProblemDetails } from '../../shared/http/problem-details.js';
import { createCatalogModule } from './index.js';
import { InMemoryProductRepository } from './infrastructure/in-memory-product-repository.js';

const ID = '0190f5c2-0000-7000-8000-000000000001';

describe('catalog HTTP routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const catalog = createCatalogModule({
      productRepository: new InMemoryProductRepository(),
      newId: () => ID,
    });
    app = Fastify();
    registerProblemDetails(app);
    await app.register(catalog.routes, { prefix: '/catalog' });
  });

  afterAll(() => app.close());

  it('POST /catalog/products creates a product (201 + Location)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/catalog/products',
      payload: { name: 'Keyboard', priceInCents: 34_990, stock: 5 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe(`/catalog/products/${ID}`);
    expect(response.json()).toEqual({ id: ID, name: 'Keyboard', priceInCents: 34_990, stock: 5 });
  });

  it('GET /catalog/products/:id returns the product', async () => {
    const response = await app.inject({ method: 'GET', url: `/catalog/products/${ID}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: ID, name: 'Keyboard' });
  });

  it('GET /catalog/products lists with pagination defaults', async () => {
    const response = await app.inject({ method: 'GET', url: '/catalog/products' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ page: 1, pageSize: 20, total: 1 });
  });

  it('GET /catalog/products/:id answers 404 Problem Details for an unknown product', async () => {
    const unknown = '0190f5c2-0000-7000-8000-00000000ffff';
    const response = await app.inject({ method: 'GET', url: `/catalog/products/${unknown}` });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 404, title: 'Not Found' });
  });

  it.each([
    { name: 'invalid id', method: 'GET', url: '/catalog/products/not-a-uuid' },
    { name: 'pageSize above 100', method: 'GET', url: '/catalog/products?pageSize=101' },
    {
      name: 'float price',
      method: 'POST',
      url: '/catalog/products',
      payload: { name: 'X', priceInCents: 10.5, stock: 1 },
    },
    {
      name: 'missing name',
      method: 'POST',
      url: '/catalog/products',
      payload: { priceInCents: 1, stock: 1 },
    },
  ] as const)('answers 400 Problem Details for $name', async ({ method, url, ...rest }) => {
    const payload = 'payload' in rest ? rest.payload : undefined;
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: 400, title: 'Bad Request' });
    expect(response.json<{ errors: unknown[] }>().errors).toHaveLength(1);
  });
});
