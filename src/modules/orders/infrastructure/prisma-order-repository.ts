import { Prisma, type PrismaClient } from '../../../shared/db/generated/client.js';
import { Order, type OrderStatus } from '../domain/order.js';
import type { OrderRepository } from '../application/order-repository.js';

/** Prisma error code for a unique constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

const withItems = { items: true } as const;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof withItems }>;

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(order: Order): Promise<boolean> {
    try {
      await this.insert(order);
      return true;
    } catch (error) {
      // The only unique key a new order can hit (its id is a fresh UUID v7) is
      // (customer_id, idempotency_key): a concurrent request with the same key won.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        return false;
      }
      throw error;
    }
  }

  private async insert(order: Order): Promise<void> {
    // Order and items in one statement: both are saved or neither is.
    await this.prisma.order.create({
      data: {
        id: order.id,
        customerId: order.customerId,
        status: order.status,
        paymentMethod: order.paymentMethod,
        totalInCents: order.totalInCents,
        createdAt: order.createdAt,
        idempotencyKey: order.idempotencyKey,
        items: {
          create: order.items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            unitPriceInCents: item.unitPriceInCents,
            quantity: item.quantity,
          })),
        },
      },
    });
  }

  async findById(id: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: withItems });
    return row ? toDomain(row) : null;
  }

  async findByIdempotencyKey(customerId: string, idempotencyKey: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
      include: withItems,
    });
    return row ? toDomain(row) : null;
  }

  /** UPDATE orders.orders SET status = ? WHERE id = ? AND status = expected (compare-and-set). */
  async updateStatus(order: Order, expected: OrderStatus): Promise<boolean> {
    const { count } = await this.prisma.order.updateMany({
      where: { id: order.id, status: expected },
      data: { status: order.status },
    });
    return count === 1;
  }
}

function toDomain(row: OrderRow): Order {
  return Order.restore({
    id: row.id,
    customerId: row.customerId,
    status: row.status,
    paymentMethod: row.paymentMethod,
    createdAt: row.createdAt,
    ...(row.idempotencyKey === null ? {} : { idempotencyKey: row.idempotencyKey }),
    items: row.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      unitPriceInCents: item.unitPriceInCents,
      quantity: item.quantity,
    })),
  });
}
