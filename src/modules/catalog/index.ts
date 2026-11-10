import type { FastifyPluginAsync } from 'fastify';
import { CreateProduct } from './application/create-product.js';
import { GetProduct } from './application/get-product.js';
import { ListProducts } from './application/list-products.js';
import type { ProductRepository, StockItem } from './application/product-repository.js';
import { ReleaseStock } from './application/release-stock.js';
import { ReserveStock } from './application/reserve-stock.js';
import { catalogRoutes } from './http/routes.js';

/**
 * Public API of the catalog module — the only entry point other code may import
 * (enforced by eslint-plugin-boundaries). Other modules get plain data (snapshots),
 * never the Product entity.
 */

export type { ProductRepository, StockItem };
export {
  CachedProductRepository,
  CATALOG_CACHE_TTL_SECONDS,
  type CachedProductRepositoryOptions,
} from './infrastructure/cached-product-repository.js';
export { InMemoryProductRepository } from './infrastructure/in-memory-product-repository.js';
export { PrismaProductRepository } from './infrastructure/prisma-product-repository.js';

export interface ProductSnapshot {
  id: string;
  name: string;
  priceInCents: number;
}

/** What other modules (orders) can ask the catalog. */
export interface CatalogApi {
  findProducts(ids: readonly string[]): Promise<ProductSnapshot[]>;
  /** Atomic, all-or-nothing. Returns false if any product is missing or lacks stock. */
  reserveStock(items: readonly StockItem[]): Promise<boolean>;
  releaseStock(items: readonly StockItem[]): Promise<void>;
}

export interface CatalogModule {
  routes: FastifyPluginAsync;
  api: CatalogApi;
}

export interface CatalogModuleDeps {
  productRepository: ProductRepository;
  newId: () => string;
}

export function createCatalogModule({
  productRepository,
  newId,
}: CatalogModuleDeps): CatalogModule {
  const reserveStock = new ReserveStock(productRepository);
  const releaseStock = new ReleaseStock(productRepository);

  return {
    routes: catalogRoutes({
      createProduct: new CreateProduct(productRepository, newId),
      getProduct: new GetProduct(productRepository),
      listProducts: new ListProducts(productRepository),
    }),
    api: {
      async findProducts(ids) {
        const products = await productRepository.findManyByIds(ids);
        return products.map(({ id, name, priceInCents }) => ({ id, name, priceInCents }));
      },
      reserveStock: (items) => reserveStock.execute(items),
      releaseStock: (items) => releaseStock.execute(items),
    },
  };
}
