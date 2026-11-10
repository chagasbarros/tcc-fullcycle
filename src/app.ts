import Fastify, { type FastifyInstance } from 'fastify';
import type { CatalogModule } from './modules/catalog/index.js';
import type { OrdersModule } from './modules/orders/index.js';
import type { Env } from './shared/config/env.js';
import { registerApiDocs } from './shared/http/api-docs.js';
import { registerMetrics } from './shared/http/metrics.js';
import { registerProblemDetails } from './shared/http/problem-details.js';
import { registerRequestIdHeader, requestIdOptions } from './shared/http/request-id.js';
import { registerRouteSpanName } from './shared/http/tracing.js';

export interface AppDeps {
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'> & Partial<Pick<Env, 'RENDER_GIT_COMMIT'>>;
  catalog: CatalogModule;
  orders: OrdersModule;
}

/**
 * Builds the HTTP app from modules that were already created (with their repositories).
 * server.ts passes Prisma-backed modules; tests pass in-memory ones. No port is opened here.
 */
export async function buildApp({ env, catalog, orders }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    ...requestIdOptions,
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            // Defense in depth: credentials never reach the logs (CLAUDE.md, section 2.6).
            redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
          },
  });

  registerRequestIdHeader(app);
  registerProblemDetails(app);
  registerMetrics(app);
  registerRouteSpanName(app);

  // version: the deployed commit (Render), so the deploy pipeline can tell the new version is live.
  const version = env.RENDER_GIT_COMMIT ?? null;
  app.get('/health', () => ({ status: 'ok', version }));
  await registerApiDocs(app);

  await app.register(catalog.routes, { prefix: '/catalog' });
  await app.register(orders.routes, { prefix: '/orders' });
  // payments has no routes: it only consumes the queue, in the worker process (ADR-0010).

  return app;
}
