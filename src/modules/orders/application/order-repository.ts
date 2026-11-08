import type { Order, OrderStatus } from '../domain/order.js';

/** Port (Repository pattern, provisional until ADR-0004). */
export interface OrderRepository {
  create(order: Order): Promise<void>;
  findById(id: string): Promise<Order | null>;
  /**
   * Saves the new status only if the stored status is still "expected"
   * (compare-and-set). Returns false when someone else changed the order first,
   * e.g. a cancel and a payment result arriving at the same time (ADR-0007).
   */
  updateStatus(order: Order, expected: OrderStatus): Promise<boolean>;
}
