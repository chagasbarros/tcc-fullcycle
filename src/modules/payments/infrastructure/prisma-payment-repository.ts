import { Prisma, type PrismaClient } from '../../../shared/db/generated/client.js';
import type { PaymentRepository } from '../application/payment-repository.js';
import { Payment } from '../domain/payment.js';

/** Prisma error code for a unique constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByOrderId(orderId: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!row) {
      return null;
    }
    return Payment.create({
      id: row.id,
      orderId: row.orderId,
      method: row.method,
      amountInCents: row.amountInCents,
      status: row.status,
      declineReason: row.declineReason,
      createdAt: row.createdAt,
    });
  }

  async create(payment: Payment): Promise<boolean> {
    try {
      await this.prisma.payment.create({
        data: {
          id: payment.id,
          orderId: payment.orderId,
          method: payment.method,
          amountInCents: payment.amountInCents,
          status: payment.status,
          declineReason: payment.declineReason,
          createdAt: payment.createdAt,
        },
      });
      return true;
    } catch (error) {
      // UNIQUE(order_id): another delivery of the same job already saved a payment.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        return false;
      }
      throw error;
    }
  }
}
