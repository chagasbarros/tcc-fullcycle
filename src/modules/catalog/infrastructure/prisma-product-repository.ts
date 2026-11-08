import type { PrismaClient } from '../../../shared/db/generated/client.js';
import { Product } from '../domain/product.js';
import type {
  ProductPage,
  ProductRepository,
  StockItem,
} from '../application/product-repository.js';

/** Thrown inside the transaction only to roll it back. */
class StockUnavailable extends Error {}

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(product: Product): Promise<void> {
    const data = {
      name: product.name,
      priceInCents: product.priceInCents,
      stock: product.stock,
    };
    await this.prisma.product.upsert({
      where: { id: product.id },
      create: { id: product.id, ...data },
      update: data,
    });
  }

  async findById(id: string): Promise<Product | null> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findManyByIds(ids: readonly string[]): Promise<Product[]> {
    const rows = await this.prisma.product.findMany({ where: { id: { in: [...ids] } } });
    return rows.map(toDomain);
  }

  async list({ offset, limit }: { offset: number; limit: number }): Promise<ProductPage> {
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({ orderBy: { id: 'asc' }, skip: offset, take: limit }),
      this.prisma.product.count(),
    ]);
    return { items: rows.map(toDomain), total };
  }

  /**
   * One conditional UPDATE per item, all inside a transaction:
   *   UPDATE catalog.products SET stock = stock - q WHERE id = ? AND stock >= q
   * The database checks and decrements in a single step, so two concurrent orders
   * can never both take the last unit. If any item fails, the whole transaction rolls back.
   */
  async reserveStock(items: readonly StockItem[]): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const { productId, quantity } of items) {
          const { count } = await tx.product.updateMany({
            where: { id: productId, stock: { gte: quantity } },
            data: { stock: { decrement: quantity } },
          });
          if (count === 0) {
            throw new StockUnavailable();
          }
        }
      });
      return true;
    } catch (error) {
      if (error instanceof StockUnavailable) {
        return false;
      }
      throw error;
    }
  }

  async releaseStock(items: readonly StockItem[]): Promise<void> {
    await this.prisma.$transaction(
      items.map(({ productId, quantity }) =>
        this.prisma.product.updateMany({
          where: { id: productId },
          data: { stock: { increment: quantity } },
        }),
      ),
    );
  }
}

function toDomain(row: { id: string; name: string; priceInCents: number; stock: number }): Product {
  return Product.create({
    id: row.id,
    name: row.name,
    priceInCents: row.priceInCents,
    stock: row.stock,
  });
}
