import { beforeEach, describe, expect, it } from 'vitest';
import type { OrderPlaced } from '../../orders/index.js';
import { InvalidPaymentError } from '../domain/payment.js';
import { FakeCardProvider, FakePixProvider } from '../infrastructure/fake-providers.js';
import { InMemoryPaymentRepository } from '../infrastructure/in-memory-payment-repository.js';
import { InMemoryPaymentResultPublisher } from '../infrastructure/in-memory-payment-result-publisher.js';
import type { ChargeRequest, ChargeResult, PaymentProvider } from './payment-provider.js';
import { ProcessPayment } from './process-payment.js';

const event = (override: Partial<OrderPlaced> = {}): OrderPlaced => ({
  orderId: 'o-1',
  customerId: 'c-1',
  totalInCents: 1_000,
  paymentMethod: 'CARD',
  ...override,
});

/** Wraps a provider and counts charges, to prove a retry never charges twice. */
class CountingProvider implements PaymentProvider {
  charges = 0;

  constructor(private readonly inner: PaymentProvider) {}

  get method() {
    return this.inner.method;
  }

  charge(request: ChargeRequest): Promise<ChargeResult> {
    this.charges++;
    return this.inner.charge(request);
  }
}

describe('ProcessPayment', () => {
  let payments: InMemoryPaymentRepository;
  let results: InMemoryPaymentResultPublisher;
  let card: CountingProvider;
  let pix: CountingProvider;
  let processPayment: ProcessPayment;

  beforeEach(() => {
    payments = new InMemoryPaymentRepository();
    results = new InMemoryPaymentResultPublisher();
    card = new CountingProvider(new FakeCardProvider());
    pix = new CountingProvider(new FakePixProvider());
    processPayment = new ProcessPayment(payments, [card, pix], results, () => 'pay-1');
  });

  it('charges with the provider of the payment method (Strategy) and publishes the result', async () => {
    const outcome = await processPayment.execute(event({ paymentMethod: 'PIX' }));

    expect(outcome).toBe('charged');
    expect(pix.charges).toBe(1);
    expect(card.charges).toBe(0);
    expect(await payments.findByOrderId('o-1')).toMatchObject({
      method: 'PIX',
      status: 'APPROVED',
    });
    expect(results.published).toEqual([{ orderId: 'o-1', approved: true }]);
  });

  it('records a declined card payment and publishes approved: false', async () => {
    await processPayment.execute(event({ totalInCents: 1_013 }));

    expect(await payments.findByOrderId('o-1')).toMatchObject({
      status: 'DECLINED',
      declineReason: 'card declined (amount ends in 13 cents)',
    });
    expect(results.published).toEqual([{ orderId: 'o-1', approved: false }]);
  });

  it('is idempotent: a redelivered event does not charge again, but republishes the result', async () => {
    await processPayment.execute(event());

    const outcome = await processPayment.execute(event());

    expect(outcome).toBe('duplicate');
    expect(card.charges).toBe(1);
    expect(payments.count).toBe(1);
    expect(results.published).toEqual([
      { orderId: 'o-1', approved: true },
      { orderId: 'o-1', approved: true },
    ]);
  });

  it('when two deliveries race, the payment saved first is the official result', async () => {
    // Simulates the other delivery saving between our check and our save.
    const realCreate = payments.create.bind(payments);
    payments.create = async (payment) => {
      const { Payment } = await import('../domain/payment.js');
      await realCreate(
        Payment.create({
          ...snapshot(payment),
          id: 'other',
          status: 'DECLINED',
          declineReason: 'x',
        }),
      );
      return realCreate(payment);
    };

    const outcome = await processPayment.execute(event());

    expect(outcome).toBe('duplicate');
    expect(results.published).toEqual([{ orderId: 'o-1', approved: false }]);
  });

  it('fails for a payment method without a provider', async () => {
    const onlyPix = new ProcessPayment(payments, [pix], results, () => 'pay-1');

    await expect(onlyPix.execute(event({ paymentMethod: 'CARD' }))).rejects.toThrow(
      InvalidPaymentError,
    );
    expect(results.published).toHaveLength(0);
  });
});

function snapshot(payment: {
  id: string;
  orderId: string;
  method: 'CARD' | 'PIX';
  amountInCents: number;
  createdAt: Date;
}) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    method: payment.method,
    amountInCents: payment.amountInCents,
    createdAt: payment.createdAt,
  };
}
