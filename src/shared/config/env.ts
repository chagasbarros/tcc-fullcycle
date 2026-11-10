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
  // Feature flags (ADR-0015): Unleash when UNLEASH_URL is set, otherwise the env values below.
  UNLEASH_URL: z.url({ protocol: /^https?$/ }).optional(),
  // Secret: comes from the environment only, never logged.
  UNLEASH_API_TOKEN: z.string().min(1).optional(),
  CATALOG_CACHE_ENABLED: z.stringbool().default(true),
});

export type Env = z.infer<typeof envSchema>;

const refined = envSchema.refine((env) => !env.UNLEASH_URL || env.UNLEASH_API_TOKEN, {
  message: 'UNLEASH_API_TOKEN is required when UNLEASH_URL is set',
  path: ['UNLEASH_API_TOKEN'],
});

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = refined.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
