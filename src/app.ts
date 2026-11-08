import Fastify, { type FastifyInstance } from 'fastify';
import type { CatalogModule } from './modules/catalog/index.js';
import type { OrdersModule } from './modules/orders/index.js';
import { paymentsModule } from './modules/payments/index.js';
import type { Env } from './shared/config/env.js';
import { registerProblemDetails } from './shared/http/problem-details.js';

export interface AppDeps {
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>;
  catalog: CatalogModule;
  orders: OrdersModule;
}

/**
 * Builds the HTTP app from modules that were already created (with their repositories).
 * server.ts passes Prisma-backed modules; tests pass in-memory ones. No port is opened here.
 */
export async function buildApp({ env, catalog, orders }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.LOG_LEVEL },
  });

  registerProblemDetails(app);

  app.get('/health', () => ({ status: 'ok' }));

  await app.register(catalog.routes, { prefix: '/catalog' });
  await app.register(orders.routes, { prefix: '/orders' });
  await app.register(paymentsModule, { prefix: '/payments' });

  return app;
}
