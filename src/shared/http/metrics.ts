import type { FastifyInstance } from 'fastify';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

/**
 * RED metrics (Rate, Errors, Duration) from a single histogram:
 *   Rate     = rate(http_request_duration_seconds_count[5m])
 *   Errors   = same, filtered by status_code=~"5.."
 *   Duration = histogram_quantile(0.95, ...) over the buckets
 * Exposed at GET /metrics for Prometheus to scrape.
 */
export function registerMetrics(app: FastifyInstance): Registry {
  // One registry per app instance (tests build many apps; a global registry would clash).
  const registry = new Registry();
  collectDefaultMetrics({ register: registry }); // CPU, memory, event loop lag, GC...

  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method, route and status code',
    labelNames: ['method', 'route', 'status_code'] as const,
    // Denser around 200 ms, the latency target of the SLO (docs/slo.md).
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  app.addHook('onResponse', async (request, reply) => {
    // The route template (/orders/:id), never the raw URL: one series per route, not per id.
    // Requests that match no route share one label, so random URLs cannot create series.
    const route = request.routeOptions.url ?? 'unmatched';
    if (route === '/metrics') return;
    duration.observe(
      { method: request.method, route, status_code: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  });

  app.get('/metrics', async (_request, reply) => {
    return reply.type(registry.contentType).send(await registry.metrics());
  });

  return registry;
}
