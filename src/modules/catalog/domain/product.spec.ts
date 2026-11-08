import { describe, expect, it } from 'vitest';
import { InvalidProductError, Product, type ProductProps } from './product.js';

const validProps: ProductProps = {
  id: '0190f5c2-0000-7000-8000-000000000001',
  name: 'Mechanical keyboard',
  priceInCents: 34_990,
  stock: 10,
};

describe('Product', () => {
  it('creates a product with valid data and trims the name', () => {
    const product = Product.create({ ...validProps, name: '  Mechanical keyboard  ' });

    expect(product.id).toBe(validProps.id);
    expect(product.name).toBe('Mechanical keyboard');
    expect(product.priceInCents).toBe(34_990);
    expect(product.stock).toBe(10);
  });

  it('accepts a free product with no stock', () => {
    expect(() => Product.create({ ...validProps, priceInCents: 0, stock: 0 })).not.toThrow();
  });

  it.each([
    ['empty name', { name: '   ' }],
    ['negative price', { priceInCents: -1 }],
    ['fractional price (float money)', { priceInCents: 10.5 }],
    ['negative stock', { stock: -1 }],
    ['fractional stock', { stock: 1.5 }],
  ])('rejects %s', (_case, override) => {
    expect(() => Product.create({ ...validProps, ...override })).toThrow(InvalidProductError);
  });

  it('checks if there is stock for a quantity', () => {
    const product = Product.create(validProps);

    expect(product.hasStockFor(1)).toBe(true);
    expect(product.hasStockFor(10)).toBe(true);
    expect(product.hasStockFor(11)).toBe(false);
    expect(product.hasStockFor(0)).toBe(false);
  });
});
