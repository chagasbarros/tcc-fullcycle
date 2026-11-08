import type { Product } from '../domain/product.js';

export interface StockItem {
  productId: string;
  quantity: number;
}

export interface ProductPage {
  items: Product[];
  total: number;
}

/**
 * Port (Repository pattern, provisional until ADR-0004): the use cases depend on
 * this interface; Prisma and in-memory implementations live in infrastructure/.
 */
export interface ProductRepository {
  save(product: Product): Promise<void>;
  findById(id: string): Promise<Product | null>;
  findManyByIds(ids: readonly string[]): Promise<Product[]>;
  list(params: { offset: number; limit: number }): Promise<ProductPage>;
  /**
   * Atomic and all-or-nothing: either every item is reserved, or nothing changes.
   * Returns false when any product is missing or lacks stock.
   */
  reserveStock(items: readonly StockItem[]): Promise<boolean>;
  releaseStock(items: readonly StockItem[]): Promise<void>;
}
