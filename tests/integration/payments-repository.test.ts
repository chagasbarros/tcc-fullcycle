import { v7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Payment } from '../../src/modules/payments/domain/payment.js';
import { PrismaPaymentRepository } from '../../src/modules/payments/index.js';
import { testPrisma, truncateAll } from './helpers.js';

const prisma = testPrisma();
const repository = new PrismaPaymentRepository(prisma);

const payment = (orderId: string, approved = true) =>
  Payment.create({
    id: v7(),
    orderId,
    method: 'CARD',
    amountInCents: 1_013,
    status: approved ? 'APPROVED' : 'DECLINED',
    declineReason: approved ? null : 'card declined (amount ends in 13 cents)',
    createdAt: new Date(),
  });

describe('PrismaPaymentRepository (PostgreSQL)', () => {
  beforeEach(() => truncateAll(prisma));
  afterAll(() => prisma.$disconnect());

  it('saves and finds a payment by order id', async () => {
    const orderId = v7();
    expect(await repository.create(payment(orderId, false))).toBe(true);

    expect(await repository.findByOrderId(orderId)).toMatchObject({
      orderId,
      status: 'DECLINED',
      declineReason: 'card declined (amount ends in 13 cents)',
    });
    expect(await repository.findByOrderId(v7())).toBeNull();
  });

  it('UNIQUE(order_id): a second payment for the same order is refused, not thrown', async () => {
    const orderId = v7();
    await repository.create(payment(orderId));

    expect(await repository.create(payment(orderId))).toBe(false);
    expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
  });
});
