import type { CatalogApi } from '../../catalog/index.js';
import { InvalidOrderError, Order, type OrderItem, type PaymentMethod } from '../domain/order.js';
import {
  IdempotencyKeyInProgressError,
  IdempotencyKeyReusedError,
  OutOfStockError,
  UnknownProductsError,
} from './errors.js';
import type { IdempotencyLock } from './idempotency-lock.js';
import type { OrderEventPublisher } from './order-event-publisher.js';
import type { OrderRepository } from './order-repository.js';

export interface PlaceOrderInput {
  customerId: string;
  paymentMethod: PaymentMethod;
  items: { productId: string; quantity: number }[];
  /** Idempotency-Key header (ADR-0016): a retry with the same key returns the same order. */
  idempotencyKey?: string;
}

export interface PlaceOrderResult {
  order: Order;
  /** true when the order already existed for this idempotency key (nothing new was done). */
  replayed: boolean;
}

/**
 * Creates an order (ADR-0009):
 * 1. copy name and price from the catalog (snapshot) and validate the order;
 * 2. reserve stock in the catalog (atomic, all-or-nothing);
 * 3. save the order; if saving fails, give the stock back;
 * 4. publish OrderPlaced so payments can charge it.
 *
 * With an idempotency key (ADR-0016), a retry of the same request returns the order
 * created the first time: no new stock reservation, no new order, no new event.
 * Requests with the same key never run at the same time (IdempotencyLock): the second one
 * gets IdempotencyKeyInProgressError instead of competing for stock.
 */
export class PlaceOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly catalog: CatalogApi,
    private readonly events: OrderEventPublisher,
    private readonly lock: IdempotencyLock,
    private readonly newId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const requested = mergeQuantities(input.items);
    const key = input.idempotencyKey;
    if (key === undefined) return this.place(input, requested);

    const outcome = await this.lock.runExclusive(`${input.customerId}:${key}`, () =>
      this.place(input, requested),
    );
    if (!outcome.acquired) throw new IdempotencyKeyInProgressError(key);
    return outcome.result;
  }

  private async place(
    input: PlaceOrderInput,
    requested: Map<string, number>,
  ): Promise<PlaceOrderResult> {
    // Fast path: a retry finds the order before touching stock.
    if (input.idempotencyKey !== undefined) {
      const existing = await this.orders.findByIdempotencyKey(
        input.customerId,
        input.idempotencyKey,
      );
      if (existing) return replay(existing, input, requested);
    }

    const products = await this.catalog.findProducts([...requested.keys()]);
    const unknown = [...requested.keys()].filter((id) => !products.some((p) => p.id === id));
    if (unknown.length > 0) {
      throw new UnknownProductsError(unknown);
    }

    const items: OrderItem[] = products.map((product) => ({
      productId: product.id,
      productName: product.name,
      unitPriceInCents: product.priceInCents,
      quantity: requested.get(product.id) ?? 0,
    }));
    const order = Order.place({
      id: this.newId(),
      customerId: input.customerId,
      paymentMethod: input.paymentMethod,
      items,
      createdAt: this.now(),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    });

    const stockItems = order.items.map(({ productId, quantity }) => ({ productId, quantity }));
    if (!(await this.catalog.reserveStock(stockItems))) {
      throw new OutOfStockError();
    }

    let created: boolean;
    try {
      created = await this.orders.create(order);
    } catch (error) {
      await this.catalog.releaseStock(stockItems);
      throw error;
    }

    if (!created) {
      // Safety net behind the lock: the UNIQUE index refused a second order with this key.
      // Undo this attempt and answer exactly like the request that saved first.
      await this.catalog.releaseStock(stockItems);
      const winner = await this.orders.findByIdempotencyKey(
        input.customerId,
        order.idempotencyKey ?? '',
      );
      if (!winner) {
        throw new Error(`order with idempotency key ${order.idempotencyKey} vanished`);
      }
      return replay(winner, input, requested);
    }

    await this.events.publishOrderPlaced({
      orderId: order.id,
      customerId: order.customerId,
      totalInCents: order.totalInCents,
      paymentMethod: order.paymentMethod,
    });
    return { order, replayed: false };
  }
}

/**
 * Same key must mean same request: same payment method and same quantities per product.
 * (customerId is part of the key's scope already.) Otherwise the client reused a key by
 * mistake, and silently returning the old order would hide that bug.
 */
function replay(
  existing: Order,
  input: PlaceOrderInput,
  requested: Map<string, number>,
): PlaceOrderResult {
  const sameItems =
    existing.items.length === requested.size &&
    existing.items.every((item) => requested.get(item.productId) === item.quantity);
  if (existing.paymentMethod !== input.paymentMethod || !sameItems) {
    throw new IdempotencyKeyReusedError(existing.idempotencyKey ?? '');
  }
  return { order: existing, replayed: true };
}

/** [{a,1},{a,2},{b,1}] -> {a:3, b:1}. Quantities are validated here, before any I/O. */
function mergeQuantities(items: PlaceOrderInput['items']): Map<string, number> {
  if (items.length === 0) {
    throw new InvalidOrderError('an order needs at least one item');
  }
  const totals = new Map<string, number>();
  for (const { productId, quantity } of items) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InvalidOrderError('quantity must be a positive integer');
    }
    totals.set(productId, (totals.get(productId) ?? 0) + quantity);
  }
  return totals;
}
