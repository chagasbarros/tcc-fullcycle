import type { OrderEventPublisher, OrderPlaced } from '../application/order-event-publisher.js';

/**
 * Keeps published events in a list. Used by tests, and by the app until the
 * BullMQ publisher arrives with the payments module (orders stay PENDING_PAYMENT meanwhile).
 */
export class InMemoryOrderEventPublisher implements OrderEventPublisher {
  readonly published: OrderPlaced[] = [];

  publishOrderPlaced(event: OrderPlaced): Promise<void> {
    this.published.push(event);
    return Promise.resolve();
  }
}
