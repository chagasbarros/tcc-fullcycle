import type { Product } from '../domain/product.js';
import type { ProductRepository } from './product-repository.js';

export interface ListProductsInput {
  page: number;
  pageSize: number;
}

export interface ListProductsOutput {
  items: Product[];
  page: number;
  pageSize: number;
  total: number;
}

export class ListProducts {
  constructor(private readonly products: ProductRepository) {}

  async execute({ page, pageSize }: ListProductsInput): Promise<ListProductsOutput> {
    const { items, total } = await this.products.list({
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    return { items, page, pageSize, total };
  }
}
