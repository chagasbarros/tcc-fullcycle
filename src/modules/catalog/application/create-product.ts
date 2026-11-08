import { Product } from '../domain/product.js';
import type { ProductRepository } from './product-repository.js';

export interface CreateProductInput {
  name: string;
  priceInCents: number;
  stock: number;
}

export class CreateProduct {
  constructor(
    private readonly products: ProductRepository,
    private readonly newId: () => string,
  ) {}

  async execute(input: CreateProductInput): Promise<Product> {
    const product = Product.create({ id: this.newId(), ...input });
    await this.products.save(product);
    return product;
  }
}
