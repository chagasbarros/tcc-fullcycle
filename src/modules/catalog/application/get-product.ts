import type { Product } from '../domain/product.js';
import { ProductNotFoundError } from './errors.js';
import type { ProductRepository } from './product-repository.js';

export class GetProduct {
  constructor(private readonly products: ProductRepository) {}

  async execute(id: string): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) {
      throw new ProductNotFoundError(id);
    }
    return product;
  }
}
