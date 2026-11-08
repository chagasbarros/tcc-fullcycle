export class InvalidOrderError extends Error {
  override readonly name = 'InvalidOrderError';
}

export class InvalidOrderTransitionError extends Error {
  override readonly name = 'InvalidOrderTransitionError';
}

/** Order states (ADR-0007). Only PENDING_PAYMENT can change; the others are final. */
export const OrderStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** How the customer chose to pay (ADR-0011). */
export const PaymentMethod = {
  CARD: 'CARD',
  PIX: 'PIX',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/** Item with a snapshot of name and price at purchase time (ADR-0009). */
export interface OrderItem {
  productId: string;
  productName: string;
  unitPriceInCents: number;
  quantity: number;
}

export interface OrderProps {
  id: string;
  customerId: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  items: OrderItem[];
  createdAt: Date;
}

export class Order {
  private constructor(private readonly props: OrderProps) {}

  /** A new order always starts waiting for payment. */
  static place(props: Omit<OrderProps, 'status'>): Order {
    return Order.restore({ ...props, status: OrderStatus.PENDING_PAYMENT });
  }

  /** Rebuilds an order that already exists (e.g. loaded from the database). */
  static restore(props: OrderProps): Order {
    if (props.items.length === 0) {
      throw new InvalidOrderError('an order needs at least one item');
    }
    const productIds = new Set(props.items.map((item) => item.productId));
    if (productIds.size !== props.items.length) {
      throw new InvalidOrderError('each product can appear only once per order');
    }
    for (const item of props.items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new InvalidOrderError('quantity must be a positive integer');
      }
      if (!Number.isInteger(item.unitPriceInCents) || item.unitPriceInCents < 0) {
        throw new InvalidOrderError('unitPriceInCents must be a non-negative integer');
      }
    }
    return new Order({ ...props, items: props.items.map((item) => ({ ...item })) });
  }

  get id(): string {
    return this.props.id;
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get status(): OrderStatus {
    return this.props.status;
  }

  get paymentMethod(): PaymentMethod {
    return this.props.paymentMethod;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get items(): readonly OrderItem[] {
    return this.props.items;
  }

  /** Integer math only: money never goes through floats. */
  get totalInCents(): number {
    return this.props.items.reduce((sum, item) => sum + item.unitPriceInCents * item.quantity, 0);
  }

  markPaid(): void {
    this.transitionTo(OrderStatus.PAID);
  }

  markPaymentFailed(): void {
    this.transitionTo(OrderStatus.PAYMENT_FAILED);
  }

  cancel(): void {
    this.transitionTo(OrderStatus.CANCELLED);
  }

  private transitionTo(next: OrderStatus): void {
    if (this.props.status !== OrderStatus.PENDING_PAYMENT) {
      throw new InvalidOrderTransitionError(
        `order ${this.props.id} is ${this.props.status} and cannot become ${next}`,
      );
    }
    this.props.status = next;
  }
}
