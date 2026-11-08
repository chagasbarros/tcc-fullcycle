import type { CatalogApi } from '../../catalog/index.js';
import { InvalidOrderTransitionError, type Order } from '../domain/order.js';
import { OrderNotFoundError } from './errors.js';
import type { OrderRepository } from './order-repository.js';

/** Cancels a pending order and gives its stock back (ADR-0007, ADR-0009). */
export class CancelOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly catalog: Pick<CatalogApi, 'releaseStock'>,
  ) {}

  async execute(id: string): Promise<Order> {
    const order = await this.orders.findById(id);
    if (!order) {
      throw new OrderNotFoundError(id);
    }

    const previous = order.status;
    order.cancel(); // throws InvalidOrderTransitionError if the state is final

    // Compare-and-set: if a payment result changed the order meanwhile, it wins.
    if (!(await this.orders.updateStatus(order, previous))) {
      throw new InvalidOrderTransitionError(`order ${id} was changed by another operation`);
    }

    await this.catalog.releaseStock(
      order.items.map(({ productId, quantity }) => ({ productId, quantity })),
    );
    return order;
  }
}
