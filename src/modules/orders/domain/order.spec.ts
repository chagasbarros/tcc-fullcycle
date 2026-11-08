import { describe, expect, it } from 'vitest';
import {
  InvalidOrderError,
  InvalidOrderTransitionError,
  Order,
  OrderStatus,
  type OrderItem,
} from './order.js';

const keyboard: OrderItem = {
  productId: 'p-keyboard',
  productName: 'Keyboard',
  unitPriceInCents: 34_990,
  quantity: 2,
};
const mouse: OrderItem = {
  productId: 'p-mouse',
  productName: 'Mouse',
  unitPriceInCents: 9_990,
  quantity: 1,
};

const place = (items: OrderItem[] = [keyboard, mouse]) =>
  Order.place({
    id: 'o-1',
    customerId: 'c-1',
    paymentMethod: 'CARD',
    items,
    createdAt: new Date('2026-11-08'),
  });

describe('Order', () => {
  it('starts as PENDING_PAYMENT and computes the total in cents', () => {
    const order = place();

    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(order.totalInCents).toBe(2 * 34_990 + 9_990);
  });

  it.each([
    ['no items', []],
    ['duplicated product', [keyboard, { ...keyboard, quantity: 1 }]],
    ['zero quantity', [{ ...keyboard, quantity: 0 }]],
    ['fractional quantity', [{ ...keyboard, quantity: 1.5 }]],
    ['negative price', [{ ...keyboard, unitPriceInCents: -1 }]],
    ['float price', [{ ...keyboard, unitPriceInCents: 10.5 }]],
  ])('rejects %s', (_case, items) => {
    expect(() => place(items)).toThrow(InvalidOrderError);
  });

  it('does not share the items array with the caller', () => {
    const items = [{ ...keyboard }];
    const order = place(items);

    items[0]!.quantity = 99;

    expect(order.items[0]!.quantity).toBe(2);
  });

  // ADR-0007: only PENDING_PAYMENT can change; every other state is final.
  const transitions = {
    markPaid: OrderStatus.PAID,
    markPaymentFailed: OrderStatus.PAYMENT_FAILED,
    cancel: OrderStatus.CANCELLED,
  } as const;

  it.each(Object.entries(transitions))('PENDING_PAYMENT --%s--> %s', (action, expected) => {
    const order = place();
    order[action as keyof typeof transitions]();
    expect(order.status).toBe(expected);
  });

  it.each(
    Object.keys(transitions).flatMap((first) =>
      Object.keys(transitions).map((second) => [first, second] as const),
    ),
  )('after %s, %s is rejected (final state)', (first, second) => {
    const order = place();
    order[first as keyof typeof transitions]();
    const finalStatus = order.status;

    expect(() => order[second as keyof typeof transitions]()).toThrow(InvalidOrderTransitionError);
    expect(order.status).toBe(finalStatus);
  });
});
