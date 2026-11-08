/** Event sent to payments through the queue (CLAUDE.md, section 4). */
export interface OrderPlaced {
  orderId: string;
  customerId: string;
  totalInCents: number;
}

/** Port: the BullMQ implementation comes with the payments module. */
export interface OrderEventPublisher {
  publishOrderPlaced(event: OrderPlaced): Promise<void>;
}
