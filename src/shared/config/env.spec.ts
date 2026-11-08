import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults when variables are not set', () => {
    expect(loadEnv({})).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('converts PORT from string to number', () => {
    expect(loadEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails fast on invalid values', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/Invalid environment variables/);
    expect(() => loadEnv({ NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
  });
});
