import { v7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Product } from '../../src/modules/catalog/domain/product.js';
import { PrismaProductRepository } from '../../src/modules/catalog/index.js';
import { testPrisma, truncateAll } from './helpers.js';

const prisma = testPrisma();
const repository = new PrismaProductRepository(prisma);

const product = (stock: number, name = 'Keyboard') =>
  Product.create({ id: v7(), name, priceInCents: 34_990, stock });

describe('PrismaProductRepository (PostgreSQL)', () => {
  beforeEach(() => truncateAll(prisma));
  afterAll(() => prisma.$disconnect());

  it('saves, updates (upsert) and finds a product', async () => {
    const keyboard = product(5);
    await repository.save(keyboard);

    keyboard.decreaseStock(2);
    await repository.save(keyboard);

    const found = await repository.findById(keyboard.id);
    expect(found).toMatchObject({ id: keyboard.id, name: 'Keyboard', stock: 3 });
    expect(await repository.findById(v7())).toBeNull();
  });

  it('lists with offset/limit, ordered by id, and returns the total', async () => {
    const products = [product(1, 'A'), product(1, 'B'), product(1, 'C')];
    for (const p of products) await repository.save(p);

    const page = await repository.list({ offset: 1, limit: 1 });

    expect(page.total).toBe(3);
    expect(page.items.map((p) => p.id)).toEqual([products[1]!.id]);
  });

  it('50 concurrent reservations against stock 10: exactly 10 succeed (ADR-0009)', async () => {
    const keyboard = product(10);
    await repository.save(keyboard);

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        repository.reserveStock([{ productId: keyboard.id, quantity: 1 }]),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(10);
    expect((await repository.findById(keyboard.id))?.stock).toBe(0);
  });

  it('rolls back the whole reservation if one item lacks stock', async () => {
    const [a, b] = [product(5, 'A'), product(1, 'B')].sort((x, y) => x.id.localeCompare(y.id));
    await repository.save(a!);
    await repository.save(b!);

    // a would succeed first, then b fails: a must be rolled back.
    const reserved = await repository.reserveStock([
      { productId: a!.id, quantity: 2 },
      { productId: b!.id, quantity: 2 },
    ]);

    expect(reserved).toBe(false);
    expect((await repository.findById(a!.id))?.stock).toBe(5);
    expect((await repository.findById(b!.id))?.stock).toBe(1);
  });

  it('releases stock back', async () => {
    const keyboard = product(1);
    await repository.save(keyboard);

    await repository.releaseStock([{ productId: keyboard.id, quantity: 4 }]);

    expect((await repository.findById(keyboard.id))?.stock).toBe(5);
  });

  it('the database CHECK rejects negative stock even if the code had a bug', async () => {
    const keyboard = product(1);
    await repository.save(keyboard);

    await expect(
      prisma.product.update({ where: { id: keyboard.id }, data: { stock: -1 } }),
    ).rejects.toThrow(/products_stock_non_negative/);
  });
});
