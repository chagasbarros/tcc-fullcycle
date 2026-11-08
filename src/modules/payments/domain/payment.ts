export class InvalidPaymentError extends Error {
  override readonly name = 'InvalidPaymentError';
}

/** Payment methods this module can charge (ADR-0011). */
export const PaymentMethod = {
  CARD: 'CARD',
  PIX: 'PIX',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export interface PaymentProps {
  id: string;
  /** One payment per order: this is what makes a redelivered job harmless. */
  orderId: string;
  method: PaymentMethod;
  amountInCents: number;
  status: PaymentStatus;
  /** Why the provider declined (empty when approved). */
  declineReason: string | null;
  createdAt: Date;
}

/** Record of a charge attempt and its final result. */
export class Payment {
  private constructor(private readonly props: PaymentProps) {}

  static create(props: PaymentProps): Payment {
    if (!Number.isInteger(props.amountInCents) || props.amountInCents < 0) {
      throw new InvalidPaymentError('amountInCents must be a non-negative integer');
    }
    if (props.status === PaymentStatus.APPROVED && props.declineReason !== null) {
      throw new InvalidPaymentError('an approved payment cannot have a decline reason');
    }
    return new Payment({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get orderId(): string {
    return this.props.orderId;
  }

  get method(): PaymentMethod {
    return this.props.method;
  }

  get amountInCents(): number {
    return this.props.amountInCents;
  }

  get status(): PaymentStatus {
    return this.props.status;
  }

  get declineReason(): string | null {
    return this.props.declineReason;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get approved(): boolean {
    return this.props.status === PaymentStatus.APPROVED;
  }
}
