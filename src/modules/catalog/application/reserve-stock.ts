import type { ProductRepository, StockItem } from './product-repository.js';
import { normalizeStockItems } from './stock-items.js';

export class ReserveStock {
  constructor(private readonly products: ProductRepository) {}

  /** Returns false (and reserves nothing) if any product is missing or lacks stock. */
  async execute(items: readonly StockItem[]): Promise<boolean> {
    return this.products.reserveStock(normalizeStockItems(items));
  }
}
