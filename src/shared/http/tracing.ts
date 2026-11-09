import { trace } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';

/**
 * The http instrumentation only knows the raw URL, so its server span is named just "POST".
 * Once Fastify has matched the route, rename it to "POST /orders/:id" (the template, so all
 * orders group together in Jaeger). Without the OTel SDK there is no active span: no-op.
 */
export function registerRouteSpanName(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    const route = request.routeOptions.url;
    const span = trace.getActiveSpan();
    if (span && route) {
      span.updateName(`${request.method} ${route}`);
      span.setAttribute('http.route', route);
    }
    done();
  });
}
