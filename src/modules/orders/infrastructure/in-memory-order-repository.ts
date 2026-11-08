import { Order, type OrderStatus } from '../domain/order.js';
import type { OrderRepository } from '../application/order-repository.js';

/** Repository kept in a Map, for unit tests. Returns copies, like a real database. */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();

  create(order: Order): Promise<void> {
    if (this.orders.has(order.id)) {
      return Promise.reject(new Error(`order ${order.id} already exists`));
    }
    this.orders.set(order.id, copy(order));
    return Promise.resolve();
  }

  findById(id: string): Promise<Order | null> {
    const order = this.orders.get(id);
    return Promise.resolve(order ? copy(order) : null);
  }

  updateStatus(order: Order, expected: OrderStatus): Promise<boolean> {
    const stored = this.orders.get(order.id);
    if (!stored || stored.status !== expected) {
      return Promise.resolve(false);
    }
    this.orders.set(order.id, copy(order));
    return Promise.resolve(true);
  }
}

function copy(order: Order): Order {
  return Order.restore({
    id: order.id,
    customerId: order.customerId,
    status: order.status,
    paymentMethod: order.paymentMethod,
    items: [...order.items],
    createdAt: order.createdAt,
  });
}
