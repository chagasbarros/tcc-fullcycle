import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadEnv', () => {
  it('applies defaults when optional variables are not set', () => {
    expect(loadEnv(required)).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_POOL_MAX: 10,
      IDEMPOTENCY_LOCK_POOL_MAX: 10,
      PAYMENT_PROVIDER_LATENCY_MS: 0,
      CATALOG_CACHE_ENABLED: true,
      RUN_WORKER_IN_PROCESS: false,
      ...required,
    });
  });

  it('converts PORT from string to number', () => {
    expect(loadEnv({ ...required, PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails fast on invalid values', () => {
    expect(() => loadEnv({ ...required, PORT: 'abc' })).toThrow(/Invalid environment variables/);
    expect(() => loadEnv({ ...required, NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
  });

  it('requires connection strings with the right protocol', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
    expect(() => loadEnv({ ...required, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it.each([
    ['false', false],
    ['0', false],
    ['true', true],
    ['1', true],
  ])('reads CATALOG_CACHE_ENABLED=%s as %s', (value, expected) => {
    expect(loadEnv({ ...required, CATALOG_CACHE_ENABLED: value }).CATALOG_CACHE_ENABLED).toBe(
      expected,
    );
  });

  it('requires UNLEASH_API_TOKEN when UNLEASH_URL is set', () => {
    expect(() => loadEnv({ ...required, UNLEASH_URL: 'http://unleash:4242/api' })).toThrow(
      /UNLEASH_API_TOKEN/,
    );
    expect(
      loadEnv({ ...required, UNLEASH_URL: 'http://unleash:4242/api', UNLEASH_API_TOKEN: 't' })
        .UNLEASH_URL,
    ).toBe('http://unleash:4242/api');
  });
});
