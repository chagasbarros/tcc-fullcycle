import type { OrderPlaced } from '../orders/index.js';
import type { PaymentProvider } from './application/payment-provider.js';
import type { PaymentRepository } from './application/payment-repository.js';
import type { PaymentResultPublisher } from './application/payment-result-publisher.js';
import { ProcessPayment, type ProcessPaymentOutcome } from './application/process-payment.js';

/**
 * Public API of the payments module — the only entry point other code may import
 * (enforced by eslint-plugin-boundaries). payments has no HTTP routes: it only
 * reacts to OrderPlaced from the queue (ADR-0010).
 */

export type { PaymentProvider, PaymentRepository, PaymentResultPublisher };
export { BullMqPaymentResultPublisher } from './infrastructure/bullmq-payment-result-publisher.js';
export { FakeCardProvider, FakePixProvider } from './infrastructure/fake-providers.js';
export { InMemoryPaymentRepository } from './infrastructure/in-memory-payment-repository.js';
export { InMemoryPaymentResultPublisher } from './infrastructure/in-memory-payment-result-publisher.js';
export { createOrderPlacedConsumer } from './infrastructure/order-placed-consumer.js';
export { PrismaPaymentRepository } from './infrastructure/prisma-payment-repository.js';

export interface PaymentsModule {
  /** Called by the OrderPlaced queue consumer. */
  processPayment(event: OrderPlaced): Promise<ProcessPaymentOutcome>;
}

export interface PaymentsModuleDeps {
  paymentRepository: PaymentRepository;
  /** One provider per payment method (Strategy, provisional until ADR-0003). */
  providers: readonly PaymentProvider[];
  resultPublisher: PaymentResultPublisher;
  newId: () => string;
}

export function createPaymentsModule({
  paymentRepository,
  providers,
  resultPublisher,
  newId,
}: PaymentsModuleDeps): PaymentsModule {
  const processPayment = new ProcessPayment(paymentRepository, providers, resultPublisher, newId);
  return { processPayment: (event) => processPayment.execute(event) };
}
