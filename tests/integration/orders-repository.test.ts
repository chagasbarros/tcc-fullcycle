import { v7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Order, OrderStatus } from '../../src/modules/orders/domain/order.js';
import { PrismaOrderRepository } from '../../src/modules/orders/index.js';
import { testPrisma, truncateAll } from './helpers.js';

const prisma = testPrisma();
const repository = new PrismaOrderRepository(prisma);

const newOrder = () =>
  Order.place({
    id: v7(),
    customerId: v7(),
    paymentMethod: 'PIX',
    createdAt: new Date('2026-11-09T12:00:00.000Z'),
    items: [
      { productId: v7(), productName: 'Keyboard', unitPriceInCents: 34_990, quantity: 2 },
      { productId: v7(), productName: 'Mouse', unitPriceInCents: 9_990, quantity: 1 },
    ],
  });

describe('PrismaOrderRepository (PostgreSQL)', () => {
  beforeEach(() => truncateAll(prisma));
  afterAll(() => prisma.$disconnect());

  it('saves an order with its items and reads it back intact', async () => {
    const order = newOrder();
    await repository.create(order);

    const found = await repository.findById(order.id);

    expect(found).not.toBeNull();
    expect(found!.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(found!.paymentMethod).toBe('PIX');
    expect(found!.totalInCents).toBe(79_970);
    expect(found!.createdAt.toISOString()).toBe('2026-11-09T12:00:00.000Z');
    expect([...found!.items].sort((a, b) => a.productName.localeCompare(b.productName))).toEqual(
      [...order.items].sort((a, b) => a.productName.localeCompare(b.productName)),
    );
    expect(await repository.findById(v7())).toBeNull();
  });

  it('updateStatus is a compare-and-set: it only applies if the status is still the expected one', async () => {
    const order = newOrder();
    await repository.create(order);

    order.markPaid();
    expect(await repository.updateStatus(order, OrderStatus.PENDING_PAYMENT)).toBe(true);

    // Stored status is now PAID, so a second change "from PENDING_PAYMENT" must fail.
    expect(await repository.updateStatus(order, OrderStatus.PENDING_PAYMENT)).toBe(false);
    expect((await repository.findById(order.id))?.status).toBe(OrderStatus.PAID);
  });

  it('20 concurrent status changes: exactly one wins (ADR-0007)', async () => {
    const order = newOrder();
    await repository.create(order);

    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const copy = (await repository.findById(order.id))!;
        if (i % 2 === 0) copy.cancel();
        else copy.markPaid();
        return repository.updateStatus(copy, OrderStatus.PENDING_PAYMENT);
      }),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
