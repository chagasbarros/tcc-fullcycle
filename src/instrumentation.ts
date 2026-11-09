/**
 * OpenTelemetry tracing. Loaded BEFORE the app with `node --import ./dist/instrumentation.js`,
 * because instrumentations patch libraries (http, pg, ioredis, pino) as they are first loaded.
 *
 * Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set (e.g. http://jaeger:4318): tests and local
 * runs without Jaeger pay nothing. Standard OTEL_* variables configure the rest
 * (OTEL_SERVICE_NAME, OTEL_TRACES_SAMPLER...).
 */
import { register } from 'node:module';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

let shutdown = (): Promise<void> => Promise.resolve();

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  // Our code is ESM: this loader hook lets the instrumentations patch ES modules too.
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'marketplace',
    traceExporter: new OTLPTraceExporter(), // sends to $OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces
    // Metrics stay with prom-client (/metrics); OTel is used for traces only.
    metricReaders: [],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Too noisy for this app: a span per file read, DNS lookup and TCP socket.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        // Health checks and Prometheus scrapes would flood Jaeger with useless traces.
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request) =>
            request.url === '/health' || request.url === '/metrics',
        },
        // Log correlation only: adds traceId/spanId to every pino line inside a span.
        '@opentelemetry/instrumentation-pino': {
          disableLogSending: true,
          logKeys: { traceId: 'traceId', spanId: 'spanId', traceFlags: 'traceFlags' },
        },
      }),
    ],
  });
  sdk.start();
  shutdown = () => sdk.shutdown();
}

/** Flushes the spans still in memory. server.ts and worker.ts call it before exiting. */
export function shutdownTracing(): Promise<void> {
  return shutdown();
}
