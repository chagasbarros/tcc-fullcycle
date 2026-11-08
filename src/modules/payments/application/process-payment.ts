import type { OrderPlaced } from '../../orders/index.js';
import {
  InvalidPaymentError,
  Payment,
  PaymentStatus,
  type PaymentMethod,
} from '../domain/payment.js';
import type { PaymentProvider } from './payment-provider.js';
import type { PaymentRepository } from './payment-repository.js';
import type { PaymentResultPublisher } from './payment-result-publisher.js';

export type ProcessPaymentOutcome = 'charged' | 'duplicate';

/**
 * Handles OrderPlaced from the queue: charges the order with the provider of its
 * payment method (Strategy) and publishes the result back to orders.
 *
 * Idempotent (CLAUDE.md, section 7): the queue may deliver the same job twice.
 * If the order already has a payment, nobody is charged again; the stored result
 * is published again, in case the previous attempt crashed before publishing.
 */
export class ProcessPayment {
  private readonly providers: Map<PaymentMethod, PaymentProvider>;

  constructor(
    private readonly payments: PaymentRepository,
    providers: readonly PaymentProvider[],
    private readonly results: PaymentResultPublisher,
    private readonly newId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.providers = new Map(providers.map((provider) => [provider.method, provider]));
  }

  async execute(event: OrderPlaced): Promise<ProcessPaymentOutcome> {
    const existing = await this.payments.findByOrderId(event.orderId);
    if (existing) {
      await this.publish(existing);
      return 'duplicate';
    }

    // Strategy: pick the implementation at runtime by payment method.
    const provider = this.providers.get(event.paymentMethod);
    if (!provider) {
      throw new InvalidPaymentError(`no provider for payment method ${event.paymentMethod}`);
    }
    const result = await provider.charge({
      idempotencyKey: event.orderId,
      amountInCents: event.totalInCents,
    });

    const payment = Payment.create({
      id: this.newId(),
      orderId: event.orderId,
      method: event.paymentMethod,
      amountInCents: event.totalInCents,
      status: result.approved ? PaymentStatus.APPROVED : PaymentStatus.DECLINED,
      declineReason: result.approved ? null : result.reason,
      createdAt: this.now(),
    });

    if (!(await this.payments.create(payment))) {
      // Another delivery of the same job saved first: its result is the official one.
      const winner = await this.payments.findByOrderId(event.orderId);
      if (winner) {
        await this.publish(winner);
      }
      return 'duplicate';
    }

    await this.publish(payment);
    return 'charged';
  }

  private publish(payment: Payment): Promise<void> {
    return this.results.publish({ orderId: payment.orderId, approved: payment.approved });
  }
}
