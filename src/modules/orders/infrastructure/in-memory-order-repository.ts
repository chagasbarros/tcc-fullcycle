import { Order, type OrderStatus } from '../domain/order.js';
import type { OrderRepository } from '../application/order-repository.js';

/** Repository kept in a Map, for unit tests. Returns copies, like a real database. */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();

  create(order: Order): Promise<boolean> {
    if (this.orders.has(order.id)) {
      return Promise.reject(new Error(`order ${order.id} already exists`));
    }
    const key = order.idempotencyKey;
    if (key !== null && this.findSync(order.customerId, key)) {
      return Promise.resolve(false); // same rule as the UNIQUE index in PostgreSQL
    }
    this.orders.set(order.id, copy(order));
    return Promise.resolve(true);
  }

  findByIdempotencyKey(customerId: string, idempotencyKey: string): Promise<Order | null> {
    const order = this.findSync(customerId, idempotencyKey);
    return Promise.resolve(order ? copy(order) : null);
  }

  private findSync(customerId: string, idempotencyKey: string): Order | undefined {
    return [...this.orders.values()].find(
      (o) => o.customerId === customerId && o.idempotencyKey === idempotencyKey,
    );
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
    ...(order.idempotencyKey === null ? {} : { idempotencyKey: order.idempotencyKey }),
  });
}
