import type { Redis } from 'ioredis';
import type {
  ProductPage,
  ProductRepository,
  StockItem,
} from '../application/product-repository.js';
import { Product, type ProductProps } from '../domain/product.js';

/** Declared staleness tolerance (docs/desempenho.md, ADR-0014): data may be up to 60 s old. */
export const CATALOG_CACHE_TTL_SECONDS = 60;

const productKey = (id: string) => `catalog:product:${id}`;
/** All list pages live in ONE hash, so a single DEL invalidates every page. */
const LIST_KEY = 'catalog:products:list';

export interface CachedProductRepositoryOptions {
  /** Read on every call: the feature flag can turn the cache off without a restart. */
  isEnabled: () => boolean;
  /** Redis failures are reported here and the read falls back to the database. */
  onError: (error: unknown) => void;
  ttlSeconds?: number;
}

/**
 * Cache-aside in front of the real repository (Decorator: same interface, so use cases
 * do not know the cache exists).
 *   - Reads (findById, list): Redis first; on a miss, the database, then store with TTL.
 *   - save (create/update a product): invalidates that product and every list page.
 *   - Stock changes are NOT invalidated: listing may show stock up to 60 s old, which is
 *     safe because placing an order re-checks stock atomically in the database (ADR-0009).
 *   - Everything else (reservations, lookups used by orders) goes straight to the database.
 */
export class CachedProductRepository implements ProductRepository {
  private readonly ttl: number;

  constructor(
    private readonly inner: ProductRepository,
    private readonly redis: Redis,
    private readonly options: CachedProductRepositoryOptions,
  ) {
    this.ttl = options.ttlSeconds ?? CATALOG_CACHE_TTL_SECONDS;
  }

  async findById(id: string): Promise<Product | null> {
    if (!this.options.isEnabled()) return this.inner.findById(id);

    const cached = await this.safely(() => this.redis.get(productKey(id)));
    if (cached) return toProduct(JSON.parse(cached) as ProductProps);

    const product = await this.inner.findById(id);
    if (product) {
      await this.safely(() =>
        this.redis.set(productKey(id), JSON.stringify(toProps(product)), 'EX', this.ttl),
      );
    }
    return product;
  }

  async list(params: { offset: number; limit: number }): Promise<ProductPage> {
    if (!this.options.isEnabled()) return this.inner.list(params);

    const field = `${params.offset}:${params.limit}`;
    const cached = await this.safely(() => this.redis.hget(LIST_KEY, field));
    if (cached) {
      const page = JSON.parse(cached) as { items: ProductProps[]; total: number };
      return { items: page.items.map(toProduct), total: page.total };
    }

    const page = await this.inner.list(params);
    const value = JSON.stringify({ items: page.items.map(toProps), total: page.total });
    await this.safely(() =>
      this.redis
        .multi()
        .hset(LIST_KEY, field, value)
        // NX: the TTL starts with the first cached page and is not pushed forward by later
        // pages, so no page is ever older than the TTL.
        .expire(LIST_KEY, this.ttl, 'NX')
        .exec(),
    );
    return page;
  }

  async save(product: Product): Promise<void> {
    await this.inner.save(product);
    // Invalidate even with the flag off, so turning it back on never serves old data.
    await this.safely(() => this.redis.del(productKey(product.id), LIST_KEY));
  }

  findManyByIds(ids: readonly string[]): Promise<Product[]> {
    return this.inner.findManyByIds(ids);
  }

  reserveStock(items: readonly StockItem[]): Promise<boolean> {
    return this.inner.reserveStock(items);
  }

  releaseStock(items: readonly StockItem[]): Promise<void> {
    return this.inner.releaseStock(items);
  }

  /** A cache problem must never fail the request: report it and behave as a miss. */
  private async safely<T>(operation: () => Promise<T>): Promise<T | null> {
    try {
      return await operation();
    } catch (error) {
      this.options.onError(error);
      return null;
    }
  }
}

function toProps(product: Product): ProductProps {
  const { id, name, priceInCents, stock } = product;
  return { id, name, priceInCents, stock };
}

function toProduct(props: ProductProps): Product {
  return Product.create(props);
}
