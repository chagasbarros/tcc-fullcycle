import type { CatalogApi } from '../../catalog/index.js';
import { InvalidOrderError, Order, type OrderItem, type PaymentMethod } from '../domain/order.js';
import { OutOfStockError, UnknownProductsError } from './errors.js';
import type { OrderEventPublisher } from './order-event-publisher.js';
import type { OrderRepository } from './order-repository.js';

export interface PlaceOrderInput {
  customerId: string;
  paymentMethod: PaymentMethod;
  items: { productId: string; quantity: number }[];
}

/**
 * Creates an order (ADR-0009):
 * 1. copy name and price from the catalog (snapshot) and validate the order;
 * 2. reserve stock in the catalog (atomic, all-or-nothing);
 * 3. save the order; if saving fails, give the stock back;
 * 4. publish OrderPlaced so payments can charge it.
 */
export class PlaceOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly catalog: CatalogApi,
    private readonly events: OrderEventPublisher,
    private readonly newId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: PlaceOrderInput): Promise<Order> {
    const requested = mergeQuantities(input.items);

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
    });

    const stockItems = order.items.map(({ productId, quantity }) => ({ productId, quantity }));
    if (!(await this.catalog.reserveStock(stockItems))) {
      throw new OutOfStockError();
    }

    try {
      await this.orders.create(order);
    } catch (error) {
      await this.catalog.releaseStock(stockItems);
      throw error;
    }

    await this.events.publishOrderPlaced({
      orderId: order.id,
      customerId: order.customerId,
      totalInCents: order.totalInCents,
      paymentMethod: order.paymentMethod,
    });
    return order;
  }
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
