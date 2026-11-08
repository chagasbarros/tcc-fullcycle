import Fastify, { type FastifyInstance } from 'fastify';
import { catalogModule } from './modules/catalog/index.js';
import { ordersModule } from './modules/orders/index.js';
import { paymentsModule } from './modules/payments/index.js';
import type { Env } from './shared/config/env.js';

/**
 * Composition root: creates the HTTP server and plugs in each module.
 * Kept separate from server.ts so tests can build the app without opening a port.
 */
export async function buildApp(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.LOG_LEVEL },
  });

  app.get('/health', () => ({ status: 'ok' }));

  await app.register(catalogModule, { prefix: '/catalog' });
  await app.register(ordersModule, { prefix: '/orders' });
  await app.register(paymentsModule, { prefix: '/payments' });

  return app;
}
