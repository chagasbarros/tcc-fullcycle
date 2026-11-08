import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { HttpProblem } from '../../../shared/http/problem-details.js';
import type { CreateProduct } from '../application/create-product.js';
import { ProductNotFoundError } from '../application/errors.js';
import type { GetProduct } from '../application/get-product.js';
import type { ListProducts } from '../application/list-products.js';
import { InvalidProductError, type Product } from '../domain/product.js';

export interface CatalogUseCases {
  createProduct: CreateProduct;
  getProduct: GetProduct;
  listProducts: ListProducts;
}

// Request schemas (mirrored in docs/openapi.yaml).
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const idParams = z.object({ id: z.uuid() });
const createBody = z.object({
  name: z.string().trim().min(1).max(200),
  priceInCents: z.number().int().min(0),
  stock: z.number().int().min(0),
});

function toResponse(product: Product) {
  return {
    id: product.id,
    name: product.name,
    priceInCents: product.priceInCents,
    stock: product.stock,
  };
}

export function catalogRoutes(useCases: CatalogUseCases): FastifyPluginAsync {
  return (app) => {
    // Translate this module's errors to HTTP; anything else goes to the global handler.
    app.setErrorHandler((error) => {
      if (error instanceof ProductNotFoundError) {
        throw new HttpProblem(404, 'Not Found', error.message);
      }
      if (error instanceof InvalidProductError) {
        throw new HttpProblem(422, 'Unprocessable Content', error.message);
      }
      throw error;
    });

    app.get('/products', async (request) => {
      const query = listQuery.parse(request.query);
      const result = await useCases.listProducts.execute(query);
      return { ...result, items: result.items.map(toResponse) };
    });

    app.get('/products/:id', async (request) => {
      const { id } = idParams.parse(request.params);
      return toResponse(await useCases.getProduct.execute(id));
    });

    app.post('/products', async (request, reply) => {
      const body = createBody.parse(request.body);
      const product = await useCases.createProduct.execute(body);
      return reply
        .status(201)
        .header('location', `/catalog/products/${product.id}`)
        .send(toResponse(product));
    });

    return Promise.resolve();
  };
}
