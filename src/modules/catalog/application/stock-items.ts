import { InvalidProductError } from '../domain/product.js';
import type { StockItem } from './product-repository.js';

/**
 * Validates quantities and merges repeated products
 * ([{a,1},{a,2}] -> [{a,3}]), sorted by productId.
 * Sorting gives every transaction the same lock order, which avoids deadlocks
 * when two orders reserve the same products at the same time.
 */
export function normalizeStockItems(items: readonly StockItem[]): StockItem[] {
  if (items.length === 0) {
    throw new InvalidProductError('at least one item is required');
  }
  const totals = new Map<string, number>();
  for (const { productId, quantity } of items) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InvalidProductError('quantity must be a positive integer');
    }
    totals.set(productId, (totals.get(productId) ?? 0) + quantity);
  }
  return [...totals.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}
