import type { CatalogApi } from '../../catalog/index.js';
import { OrderStatus } from '../domain/order.js';
import { OrderNotFoundError } from './errors.js';
import type { OrderRepository } from './order-repository.js';

export interface PaymentResult {
  orderId: string;
  approved: boolean;
}

export type ApplyPaymentResultOutcome = 'applied' | 'ignored';

/**
 * Handles PaymentApproved / PaymentFailed coming from the queue.
 * Idempotent: the queue may deliver the same message twice; if the order is no
 * longer PENDING_PAYMENT, the message is ignored (ADR-0007).
 */
export class ApplyPaymentResult {
  constructor(
    private readonly orders: OrderRepository,
    private readonly catalog: Pick<CatalogApi, 'releaseStock'>,
  ) {}

  async execute({ orderId, approved }: PaymentResult): Promise<ApplyPaymentResultOutcome> {
    const order = await this.orders.findById(orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      return 'ignored';
    }

    if (approved) {
      order.markPaid();
    } else {
      order.markPaymentFailed();
    }

    // Lost the race (e.g. the customer cancelled at the same moment): nothing to do.
    if (!(await this.orders.updateStatus(order, OrderStatus.PENDING_PAYMENT))) {
      return 'ignored';
    }

    if (!approved) {
      await this.catalog.releaseStock(
        order.items.map(({ productId, quantity }) => ({ productId, quantity })),
      );
    }
    return 'applied';
  }
}
