import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { HttpProblem } from '../../../shared/http/problem-details.js';
import type { CancelOrder } from '../application/cancel-order.js';
import {
  OrderNotFoundError,
  OutOfStockError,
  UnknownProductsError,
} from '../application/errors.js';
import type { GetOrder } from '../application/get-order.js';
import type { PlaceOrder } from '../application/place-order.js';
import { InvalidOrderError, InvalidOrderTransitionError, type Order } from '../domain/order.js';

export interface OrdersUseCases {
  placeOrder: PlaceOrder;
  getOrder: GetOrder;
  cancelOrder: CancelOrder;
}

// Request schemas (mirrored in docs/openapi.yaml).
const idParams = z.object({ id: z.uuid() });
const placeOrderBody = z.object({
  customerId: z.uuid(),
  paymentMethod: z.enum(['CARD', 'PIX']),
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.number().int().min(1).max(1000),
      }),
    )
    .min(1)
    .max(50),
});

function toResponse(order: Order) {
  return {
    id: order.id,
    customerId: order.customerId,
    status: order.status,
    paymentMethod: order.paymentMethod,
    totalInCents: order.totalInCents,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      unitPriceInCents: item.unitPriceInCents,
      quantity: item.quantity,
      subtotalInCents: item.unitPriceInCents * item.quantity,
    })),
  };
}

export function ordersRoutes(useCases: OrdersUseCases): FastifyPluginAsync {
  return (app) => {
    // Translate this module's errors to HTTP; anything else goes to the global handler.
    app.setErrorHandler((error) => {
      if (error instanceof OrderNotFoundError) {
        throw new HttpProblem(404, 'Not Found', error.message);
      }
      if (error instanceof OutOfStockError || error instanceof InvalidOrderTransitionError) {
        throw new HttpProblem(409, 'Conflict', error.message);
      }
      if (error instanceof UnknownProductsError || error instanceof InvalidOrderError) {
        throw new HttpProblem(422, 'Unprocessable Content', error.message);
      }
      throw error;
    });

    app.post('/', async (request, reply) => {
      const body = placeOrderBody.parse(request.body);
      const order = await useCases.placeOrder.execute(body);
      return reply.status(201).header('location', `/orders/${order.id}`).send(toResponse(order));
    });

    app.get('/:id', async (request) => {
      const { id } = idParams.parse(request.params);
      return toResponse(await useCases.getOrder.execute(id));
    });

    // Cancel takes no body. Some HTTP clients still send an empty chunked body without
    // Content-Type, which Fastify rejects with 415 (found by the Pact contract test).
    // In this child context only, any body is drained and ignored.
    void app.register((bodyless) => {
      bodyless.addContentTypeParser('*', (_request, payload, done) => {
        payload.resume();
        payload.on('end', () => done(null, undefined));
      });

      bodyless.post('/:id/cancel', async (request) => {
        const { id } = idParams.parse(request.params);
        return toResponse(await useCases.cancelOrder.execute(id));
      });

      return Promise.resolve();
    });

    return Promise.resolve();
  };
}
