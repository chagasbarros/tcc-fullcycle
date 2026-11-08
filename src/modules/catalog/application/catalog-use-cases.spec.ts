import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidProductError, Product } from '../domain/product.js';
import { InMemoryProductRepository } from '../infrastructure/in-memory-product-repository.js';
import { CreateProduct } from './create-product.js';
import { ProductNotFoundError } from './errors.js';
import { GetProduct } from './get-product.js';
import { ListProducts } from './list-products.js';
import { ReleaseStock } from './release-stock.js';
import { ReserveStock } from './reserve-stock.js';

const KEYBOARD = '00000000-0000-7000-8000-000000000001';
const MOUSE = '00000000-0000-7000-8000-000000000002';

describe('catalog use cases', () => {
  let repository: InMemoryProductRepository;

  beforeEach(async () => {
    repository = new InMemoryProductRepository();
    await repository.save(
      Product.create({ id: KEYBOARD, name: 'Keyboard', priceInCents: 34_990, stock: 5 }),
    );
    await repository.save(
      Product.create({ id: MOUSE, name: 'Mouse', priceInCents: 9_990, stock: 1 }),
    );
  });

  const stockOf = async (id: string) => (await repository.findById(id))?.stock;

  describe('CreateProduct', () => {
    it('creates a product with a generated id and saves it', async () => {
      const createProduct = new CreateProduct(repository, () => 'new-id');

      const product = await createProduct.execute({ name: 'Monitor', priceInCents: 1, stock: 0 });

      expect(product.id).toBe('new-id');
      expect(await repository.findById('new-id')).not.toBeNull();
    });

    it('does not save an invalid product', async () => {
      const createProduct = new CreateProduct(repository, () => 'new-id');

      await expect(
        createProduct.execute({ name: 'Monitor', priceInCents: -1, stock: 0 }),
      ).rejects.toThrow(InvalidProductError);
      expect(await repository.findById('new-id')).toBeNull();
    });
  });

  describe('GetProduct', () => {
    it('returns the product', async () => {
      const product = await new GetProduct(repository).execute(KEYBOARD);
      expect(product.name).toBe('Keyboard');
    });

    it('throws ProductNotFoundError when it does not exist', async () => {
      await expect(new GetProduct(repository).execute('missing')).rejects.toThrow(
        ProductNotFoundError,
      );
    });
  });

  describe('ListProducts', () => {
    it('paginates and returns the total', async () => {
      const listProducts = new ListProducts(repository);

      const page1 = await listProducts.execute({ page: 1, pageSize: 1 });
      const page2 = await listProducts.execute({ page: 2, pageSize: 1 });

      expect(page1).toMatchObject({ page: 1, pageSize: 1, total: 2 });
      expect(page1.items.map((p) => p.id)).toEqual([KEYBOARD]);
      expect(page2.items.map((p) => p.id)).toEqual([MOUSE]);
    });
  });

  describe('ReserveStock / ReleaseStock', () => {
    it('reserves stock of every item', async () => {
      const reserved = await new ReserveStock(repository).execute([
        { productId: KEYBOARD, quantity: 2 },
        { productId: MOUSE, quantity: 1 },
      ]);

      expect(reserved).toBe(true);
      expect(await stockOf(KEYBOARD)).toBe(3);
      expect(await stockOf(MOUSE)).toBe(0);
    });

    it('is all-or-nothing: one item without stock reserves nothing', async () => {
      const reserved = await new ReserveStock(repository).execute([
        { productId: KEYBOARD, quantity: 2 },
        { productId: MOUSE, quantity: 2 },
      ]);

      expect(reserved).toBe(false);
      expect(await stockOf(KEYBOARD)).toBe(5);
      expect(await stockOf(MOUSE)).toBe(1);
    });

    it('fails for an unknown product', async () => {
      const reserved = await new ReserveStock(repository).execute([
        { productId: 'missing', quantity: 1 },
      ]);
      expect(reserved).toBe(false);
    });

    it('merges repeated products before checking stock', async () => {
      // 1 + 1 = 2 mice, but there is only 1.
      const reserved = await new ReserveStock(repository).execute([
        { productId: MOUSE, quantity: 1 },
        { productId: MOUSE, quantity: 1 },
      ]);

      expect(reserved).toBe(false);
      expect(await stockOf(MOUSE)).toBe(1);
    });

    it.each([
      ['no items', []],
      ['zero quantity', [{ productId: MOUSE, quantity: 0 }]],
      ['fractional quantity', [{ productId: MOUSE, quantity: 1.5 }]],
    ])('rejects %s', async (_case, items) => {
      await expect(new ReserveStock(repository).execute(items)).rejects.toThrow(
        InvalidProductError,
      );
    });

    it('releases stock back', async () => {
      await new ReleaseStock(repository).execute([{ productId: KEYBOARD, quantity: 3 }]);
      expect(await stockOf(KEYBOARD)).toBe(8);
    });
  });
});
