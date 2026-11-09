import { z } from 'zod';

/**
 * Every setting comes from environment variables and is validated at boot.
 * If something is missing or invalid, the app refuses to start (fail fast).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Connection strings may carry credentials: required, no default.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // Simulated payment gateway latency for the fake providers (ADR-0011).
  PAYMENT_PROVIDER_LATENCY_MS: z.coerce.number().int().min(0).default(0),
  // Tracing (src/instrumentation.ts reads these before the app starts; validated here too).
  // Unset = tracing off.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  OTEL_SERVICE_NAME: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
