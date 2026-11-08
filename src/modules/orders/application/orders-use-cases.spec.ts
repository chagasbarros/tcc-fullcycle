import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogApi, ProductSnapshot, StockItem } from '../../catalog/index.js';
import { InvalidOrderError, InvalidOrderTransitionError, OrderStatus } from '../domain/order.js';
import { InMemoryOrderEventPublisher } from '../infrastructure/in-memory-order-event-publisher.js';
import { InMemoryOrderRepository } from '../infrastructure/in-memory-order-repository.js';
import { ApplyPaymentResult } from './apply-payment-result.js';
import { CancelOrder } from './cancel-order.js';
import { OrderNotFoundError, OutOfStockError, UnknownProductsError } from './errors.js';
import { GetOrder } from './get-order.js';
import { PlaceOrder } from './place-order.js';

const CUSTOMER = 'c0000000-0000-7000-8000-000000000001';
const MISSING = 'p0000000-0000-7000-8000-00000000ffff';

/**
 * Fake catalog that implements only the public CatalogApi contract.
 * The real reservation rules (atomic, all-or-nothing) are tested in the catalog module.
 */
class FakeCatalog implements CatalogApi {
  private readonly stock = new Map<string, number>();
  private readonly products = new Map<string, ProductSnapshot>();

  add(product: ProductSnapshot, stock: number): void {
    this.products.set(product.id, product);
    this.stock.set(product.id, stock);
  }

  stockOf(id: string): number {
    return this.stock.get(id) ?? Number.NaN;
  }

  findProducts(ids: readonly string[]): Promise<ProductSnapshot[]> {
    return Promise.resolve(ids.flatMap((id) => this.products.get(id) ?? []));
  }

  reserveStock(items: readonly StockItem[]): Promise<boolean> {
    const ok = items.every((i) => (this.stock.get(i.productId) ?? 0) >= i.quantity);
    if (ok) {
      items.forEach((i) => this.stock.set(i.productId, this.stockOf(i.productId) - i.quantity));
    }
    return Promise.resolve(ok);
  }

  releaseStock(items: readonly StockItem[]): Promise<void> {
    items.forEach((i) => this.stock.set(i.productId, this.stockOf(i.productId) + i.quantity));
    return Promise.resolve();
  }
}

const keyboardId = 'p0000000-0000-7000-8000-000000000001';
const mouseId = 'p0000000-0000-7000-8000-000000000002';

describe('orders use cases', () => {
  let orders: InMemoryOrderRepository;
  let events: InMemoryOrderEventPublisher;
  let catalog: FakeCatalog;
  let placeOrder: PlaceOrder;

  const stockOf = (id: string) => Promise.resolve(catalog.stockOf(id));

  beforeEach(() => {
    catalog = new FakeCatalog();
    catalog.add({ id: keyboardId, name: 'Keyboard', priceInCents: 34_990 }, 5);
    catalog.add({ id: mouseId, name: 'Mouse', priceInCents: 9_990 }, 1);

    orders = new InMemoryOrderRepository();
    events = new InMemoryOrderEventPublisher();
    placeOrder = new PlaceOrder(
      orders,
      catalog,
      events,
      () => 'o-1',
      () => new Date('2026-11-08'),
    );
  });

  const placeDefault = () =>
    placeOrder.execute({
      customerId: CUSTOMER,
      paymentMethod: 'CARD',
      items: [
        { productId: keyboardId, quantity: 2 },
        { productId: mouseId, quantity: 1 },
      ],
    });

  describe('PlaceOrder', () => {
    it('creates a pending order with a price snapshot, reserves stock and publishes OrderPlaced', async () => {
      const order = await placeDefault();

      expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(order.items).toEqual([
        { productId: keyboardId, productName: 'Keyboard', unitPriceInCents: 34_990, quantity: 2 },
        { productId: mouseId, productName: 'Mouse', unitPriceInCents: 9_990, quantity: 1 },
      ]);
      expect(order.totalInCents).toBe(79_970);
      expect(await stockOf(keyboardId)).toBe(3);
      expect(await stockOf(mouseId)).toBe(0);
      expect(await orders.findById('o-1')).not.toBeNull();
      expect(events.published).toEqual([
        { orderId: 'o-1', customerId: CUSTOMER, paymentMethod: 'CARD', totalInCents: 79_970 },
      ]);
    });

    it('merges repeated products into one item', async () => {
      const order = await placeOrder.execute({
        customerId: CUSTOMER,
        paymentMethod: 'CARD',
        items: [
          { productId: keyboardId, quantity: 1 },
          { productId: keyboardId, quantity: 2 },
        ],
      });

      expect(order.items).toHaveLength(1);
      expect(order.items[0]?.quantity).toBe(3);
    });

    it('rejects unknown products without touching stock', async () => {
      await expect(
        placeOrder.execute({
          customerId: CUSTOMER,
          paymentMethod: 'CARD',
          items: [
            { productId: keyboardId, quantity: 1 },
            { productId: MISSING, quantity: 1 },
          ],
        }),
      ).rejects.toThrow(UnknownProductsError);
      expect(await stockOf(keyboardId)).toBe(5);
      expect(events.published).toHaveLength(0);
    });

    it('fails with OutOfStockError and saves nothing when stock is not enough', async () => {
      await expect(
        placeOrder.execute({
          customerId: CUSTOMER,
          paymentMethod: 'CARD',
          items: [{ productId: mouseId, quantity: 2 }],
        }),
      ).rejects.toThrow(OutOfStockError);
      expect(await orders.findById('o-1')).toBeNull();
      expect(events.published).toHaveLength(0);
    });

    it.each([
      ['no items', []],
      ['zero quantity', [{ productId: keyboardId, quantity: 0 }]],
    ])('rejects %s before any I/O', async (_case, items) => {
      await expect(
        placeOrder.execute({ customerId: CUSTOMER, paymentMethod: 'CARD', items }),
      ).rejects.toThrow(InvalidOrderError);
    });

    it('gives the stock back if saving the order fails', async () => {
      const failing = new InMemoryOrderRepository();
      failing.create = () => Promise.reject(new Error('database is down'));
      const place = new PlaceOrder(failing, catalog, events, () => 'o-1');

      await expect(
        place.execute({
          customerId: CUSTOMER,
          paymentMethod: 'CARD',
          items: [{ productId: keyboardId, quantity: 2 }],
        }),
      ).rejects.toThrow('database is down');
      expect(await stockOf(keyboardId)).toBe(5);
      expect(events.published).toHaveLength(0);
    });
  });

  describe('GetOrder', () => {
    it('returns the order or throws OrderNotFoundError', async () => {
      await placeDefault();

      expect((await new GetOrder(orders).execute('o-1')).id).toBe('o-1');
      await expect(new GetOrder(orders).execute('nope')).rejects.toThrow(OrderNotFoundError);
    });
  });

  describe('CancelOrder', () => {
    it('cancels a pending order and gives the stock back', async () => {
      await placeDefault();

      const order = await new CancelOrder(orders, catalog).execute('o-1');

      expect(order.status).toBe(OrderStatus.CANCELLED);
      expect((await orders.findById('o-1'))?.status).toBe(OrderStatus.CANCELLED);
      expect(await stockOf(keyboardId)).toBe(5);
      expect(await stockOf(mouseId)).toBe(1);
    });

    it('cannot cancel twice (stock is given back only once)', async () => {
      await placeDefault();
      const cancel = new CancelOrder(orders, catalog);
      await cancel.execute('o-1');

      await expect(cancel.execute('o-1')).rejects.toThrow(InvalidOrderTransitionError);
      expect(await stockOf(keyboardId)).toBe(5);
    });

    it('loses the race if the order changed meanwhile (compare-and-set)', async () => {
      await placeDefault();
      orders.updateStatus = () => Promise.resolve(false);

      await expect(new CancelOrder(orders, catalog).execute('o-1')).rejects.toThrow(
        InvalidOrderTransitionError,
      );
      expect(await stockOf(keyboardId)).toBe(3);
    });

    it('throws OrderNotFoundError for an unknown order', async () => {
      await expect(new CancelOrder(orders, catalog).execute('nope')).rejects.toThrow(
        OrderNotFoundError,
      );
    });
  });

  describe('ApplyPaymentResult', () => {
    it('approved: marks the order PAID and keeps the stock reserved', async () => {
      await placeDefault();

      const outcome = await new ApplyPaymentResult(orders, catalog).execute({
        orderId: 'o-1',
        approved: true,
      });

      expect(outcome).toBe('applied');
      expect((await orders.findById('o-1'))?.status).toBe(OrderStatus.PAID);
      expect(await stockOf(keyboardId)).toBe(3);
    });

    it('failed: marks PAYMENT_FAILED and gives the stock back', async () => {
      await placeDefault();

      await new ApplyPaymentResult(orders, catalog).execute({ orderId: 'o-1', approved: false });

      expect((await orders.findById('o-1'))?.status).toBe(OrderStatus.PAYMENT_FAILED);
      expect(await stockOf(keyboardId)).toBe(5);
    });

    it('is idempotent: a redelivered message is ignored', async () => {
      await placeDefault();
      const apply = new ApplyPaymentResult(orders, catalog);
      await apply.execute({ orderId: 'o-1', approved: false });

      const second = await apply.execute({ orderId: 'o-1', approved: false });

      expect(second).toBe('ignored');
      expect(await stockOf(keyboardId)).toBe(5); // not given back twice
    });

    it('ignores the result if the order was cancelled first', async () => {
      await placeDefault();
      await new CancelOrder(orders, catalog).execute('o-1');

      const outcome = await new ApplyPaymentResult(orders, catalog).execute({
        orderId: 'o-1',
        approved: true,
      });

      expect(outcome).toBe('ignored');
      expect((await orders.findById('o-1'))?.status).toBe(OrderStatus.CANCELLED);
    });

    it('ignores the result if it loses the compare-and-set race', async () => {
      await placeDefault();
      orders.updateStatus = () => Promise.resolve(false);

      const outcome = await new ApplyPaymentResult(orders, catalog).execute({
        orderId: 'o-1',
        approved: false,
      });

      expect(outcome).toBe('ignored');
      expect(await stockOf(keyboardId)).toBe(3);
    });

    it('throws OrderNotFoundError for an unknown order', async () => {
      await expect(
        new ApplyPaymentResult(orders, catalog).execute({ orderId: 'nope', approved: true }),
      ).rejects.toThrow(OrderNotFoundError);
    });
  });
});
