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

/** The same Idempotency-Key was already used by this customer for a DIFFERENT order. */
export class IdempotencyKeyReusedError extends Error {
  override readonly name = 'IdempotencyKeyReusedError';

  constructor(readonly idempotencyKey: string) {
    super(`Idempotency-Key "${idempotencyKey}" was already used for a different order`);
  }
}

/** Another request with the same Idempotency-Key is still being processed: retry shortly. */
export class IdempotencyKeyInProgressError extends Error {
  override readonly name = 'IdempotencyKeyInProgressError';

  constructor(readonly idempotencyKey: string) {
    super(`a request with Idempotency-Key "${idempotencyKey}" is still in progress, retry shortly`);
  }
}
