import type { ProductRepository, StockItem } from './product-repository.js';
import { normalizeStockItems } from './stock-items.js';

/** Gives reserved stock back (payment failed or order cancelled). */
export class ReleaseStock {
  constructor(private readonly products: ProductRepository) {}

  async execute(items: readonly StockItem[]): Promise<void> {
    await this.products.releaseStock(normalizeStockItems(items));
  }
}
