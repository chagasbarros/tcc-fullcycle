export class OrderNotFoundError extends Error {
  override readonly name = 'OrderNotFoundError';

  constructor(readonly orderId: string) {
    super(`order ${orderId} not found`);
  }
}

export class UnknownProductsError extends Error {
  override readonly name = 'UnknownProductsError';

  constructor(readonly productIds: string[]) {
    super(`unknown products: ${productIds.join(', ')}`);
  }
}

export class OutOfStockError extends Error {
  override readonly name = 'OutOfStockError';

  constructor() {
    super('one or more products do not have enough stock');
  }
}
