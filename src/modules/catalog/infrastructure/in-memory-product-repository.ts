import { Product } from '../domain/product.js';
import type {
  ProductPage,
  ProductRepository,
  StockItem,
} from '../application/product-repository.js';

/**
 * Repository kept in a Map. Used by unit tests (no database needed).
 * Returns copies, like a real database would, so callers cannot change stored data by accident.
 */
export class InMemoryProductRepository implements ProductRepository {
  private readonly products = new Map<string, Product>();

  save(product: Product): Promise<void> {
    this.products.set(product.id, copy(product));
    return Promise.resolve();
  }

  findById(id: string): Promise<Product | null> {
    const product = this.products.get(id);
    return Promise.resolve(product ? copy(product) : null);
  }

  findManyByIds(ids: readonly string[]): Promise<Product[]> {
    const found = ids.flatMap((id) => {
      const product = this.products.get(id);
      return product ? [copy(product)] : [];
    });
    return Promise.resolve(found);
  }

  list({ offset, limit }: { offset: number; limit: number }): Promise<ProductPage> {
    const all = [...this.products.values()].sort((a, b) => a.id.localeCompare(b.id));
    return Promise.resolve({
      items: all.slice(offset, offset + limit).map(copy),
      total: all.length,
    });
  }

  reserveStock(items: readonly StockItem[]): Promise<boolean> {
    // Check everything first, then change: all-or-nothing.
    const canReserve = items.every(({ productId, quantity }) =>
      this.products.get(productId)?.hasStockFor(quantity),
    );
    if (canReserve) {
      for (const { productId, quantity } of items) {
        this.products.get(productId)?.decreaseStock(quantity);
      }
    }
    return Promise.resolve(canReserve);
  }

  releaseStock(items: readonly StockItem[]): Promise<void> {
    for (const { productId, quantity } of items) {
      this.products.get(productId)?.increaseStock(quantity);
    }
    return Promise.resolve();
  }
}

function copy(product: Product): Product {
  return Product.create({
    id: product.id,
    name: product.name,
    priceInCents: product.priceInCents,
    stock: product.stock,
  });
}
