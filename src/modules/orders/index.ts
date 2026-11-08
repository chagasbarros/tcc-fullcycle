import type { FastifyPluginAsync } from 'fastify';
import type { CatalogApi } from '../catalog/index.js';
import {
  ApplyPaymentResult,
  type ApplyPaymentResultOutcome,
  type PaymentResult,
} from './application/apply-payment-result.js';
import { CancelOrder } from './application/cancel-order.js';
import { GetOrder } from './application/get-order.js';
import type { OrderEventPublisher, OrderPlaced } from './application/order-event-publisher.js';
import type { OrderRepository } from './application/order-repository.js';
import { PlaceOrder } from './application/place-order.js';
import { ordersRoutes } from './http/routes.js';

/**
 * Public API of the orders module — the only entry point other code may import
 * (enforced by eslint-plugin-boundaries).
 */

export type { OrderEventPublisher, OrderPlaced, OrderRepository, PaymentResult };
export { InMemoryOrderEventPublisher } from './infrastructure/in-memory-order-event-publisher.js';
export { InMemoryOrderRepository } from './infrastructure/in-memory-order-repository.js';
export { PrismaOrderRepository } from './infrastructure/prisma-order-repository.js';

export interface OrdersModule {
  routes: FastifyPluginAsync;
  /** Called by the queue consumer when payments answers (PaymentApproved / PaymentFailed). */
  applyPaymentResult(result: PaymentResult): Promise<ApplyPaymentResultOutcome>;
}

export interface OrdersModuleDeps {
  orderRepository: OrderRepository;
  /** orders talks to catalog only through its public API (ADR-0009). */
  catalog: CatalogApi;
  eventPublisher: OrderEventPublisher;
  newId: () => string;
}

export function createOrdersModule({
  orderRepository,
  catalog,
  eventPublisher,
  newId,
}: OrdersModuleDeps): OrdersModule {
  const applyPaymentResult = new ApplyPaymentResult(orderRepository, catalog);

  return {
    routes: ordersRoutes({
      placeOrder: new PlaceOrder(orderRepository, catalog, eventPublisher, newId),
      getOrder: new GetOrder(orderRepository),
      cancelOrder: new CancelOrder(orderRepository, catalog),
    }),
    applyPaymentResult: (result) => applyPaymentResult.execute(result),
  };
}
