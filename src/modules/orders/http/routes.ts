import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { HttpProblem } from '../../../shared/http/problem-details.js';
import type { CancelOrder } from '../application/cancel-order.js';
import {
  IdempotencyKeyInProgressError,
  IdempotencyKeyReusedError,
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

// Idempotency-Key (ADR-0016): optional; visible ASCII only, at most 255 characters.
const idempotencyHeaders = z.object({
  'idempotency-key': z
    .string()
    .regex(/^[!-~]{1,255}$/, 'must be 1-255 visible ASCII characters')
    .optional(),
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
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof OrderNotFoundError) {
        throw new HttpProblem(404, 'Not Found', error.message);
      }
      if (error instanceof IdempotencyKeyInProgressError) {
        // The first request with this key is still running; its answer will be replayed.
        void reply.header('retry-after', '1');
        throw new HttpProblem(409, 'Conflict', error.message);
      }
      if (error instanceof OutOfStockError || error instanceof InvalidOrderTransitionError) {
        throw new HttpProblem(409, 'Conflict', error.message);
      }
      if (
        error instanceof UnknownProductsError ||
        error instanceof InvalidOrderError ||
        error instanceof IdempotencyKeyReusedError
      ) {
        throw new HttpProblem(422, 'Unprocessable Content', error.message);
      }
      throw error;
    });

    app.post('/', async (request, reply) => {
      const body = placeOrderBody.parse(request.body);
      const headers = idempotencyHeaders.parse(request.headers);
      const idempotencyKey = headers['idempotency-key'];
      const { order, replayed } = await useCases.placeOrder.execute({
        ...body,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      });
      // A replay answers like the first request (201 + same order, current status),
      // flagged so the client can tell nothing new was created.
      if (replayed) void reply.header('idempotent-replayed', 'true');
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
