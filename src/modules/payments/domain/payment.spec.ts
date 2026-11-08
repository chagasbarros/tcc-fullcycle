import { describe, expect, it } from 'vitest';
import { InvalidPaymentError, Payment, type PaymentProps } from './payment.js';

const approved: PaymentProps = {
  id: 'pay-1',
  orderId: 'o-1',
  method: 'CARD',
  amountInCents: 1_000,
  status: 'APPROVED',
  declineReason: null,
  createdAt: new Date('2026-11-08'),
};

describe('Payment', () => {
  it('creates an approved payment', () => {
    const payment = Payment.create(approved);

    expect(payment.approved).toBe(true);
    expect(payment).toMatchObject({ orderId: 'o-1', method: 'CARD', amountInCents: 1_000 });
  });

  it('creates a declined payment with a reason', () => {
    const payment = Payment.create({ ...approved, status: 'DECLINED', declineReason: 'nope' });

    expect(payment.approved).toBe(false);
    expect(payment.declineReason).toBe('nope');
  });

  it.each([
    ['negative amount', { amountInCents: -1 }],
    ['float amount', { amountInCents: 10.5 }],
    ['approved with a decline reason', { declineReason: 'nope' }],
  ])('rejects %s', (_case, override) => {
    expect(() => Payment.create({ ...approved, ...override })).toThrow(InvalidPaymentError);
  });
});
