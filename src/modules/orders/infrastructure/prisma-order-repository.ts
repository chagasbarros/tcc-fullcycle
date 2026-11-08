import type { PrismaClient } from '../../../shared/db/generated/client.js';
import { Order, type OrderStatus } from '../domain/order.js';
import type { OrderRepository } from '../application/order-repository.js';

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(order: Order): Promise<void> {
    // Order and items in one statement: both are saved or neither is.
    await this.prisma.order.create({
      data: {
        id: order.id,
        customerId: order.customerId,
        status: order.status,
        totalInCents: order.totalInCents,
        createdAt: order.createdAt,
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
    const row = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!row) {
      return null;
    }
    return Order.restore({
      id: row.id,
      customerId: row.customerId,
      status: row.status,
      createdAt: row.createdAt,
      items: row.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        unitPriceInCents: item.unitPriceInCents,
        quantity: item.quantity,
      })),
    });
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
