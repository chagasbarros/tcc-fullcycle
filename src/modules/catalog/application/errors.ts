export class ProductNotFoundError extends Error {
  override readonly name = 'ProductNotFoundError';

  constructor(readonly productId: string) {
    super(`product ${productId} not found`);
  }
}
