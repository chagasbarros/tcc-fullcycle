import type { Queue } from 'bullmq';
import type { OrderEventPublisher, OrderPlaced } from '../application/order-event-publisher.js';

export class BullMqOrderEventPublisher implements OrderEventPublisher {
  constructor(private readonly queue: Queue<OrderPlaced>) {}

  async publishOrderPlaced(event: OrderPlaced): Promise<void> {
    // jobId = orderId: BullMQ refuses a second job with the same id (CLAUDE.md, section 7).
    await this.queue.add('OrderPlaced', event, { jobId: event.orderId });
  }
}
