import { describe, expect, it, vi } from 'vitest';
import { createFeatureFlags } from './create-feature-flags.js';
import { EnvFeatureFlags, Flag, UnleashFeatureFlags } from './feature-flags.js';

describe('feature flags', () => {
  it('without Unleash, the flag comes from CATALOG_CACHE_ENABLED', () => {
    const on = createFeatureFlags({ CATALOG_CACHE_ENABLED: true }, 'test', vi.fn());
    const off = createFeatureFlags({ CATALOG_CACHE_ENABLED: false }, 'test', vi.fn());

    expect(on).toBeInstanceOf(EnvFeatureFlags);
    expect(on.isEnabled(Flag.CATALOG_CACHE_ENABLED)).toBe(true);
    expect(off.isEnabled(Flag.CATALOG_CACHE_ENABLED)).toBe(false);
  });

  it('with UNLEASH_URL, uses Unleash and falls back to the env value while it is unreachable', () => {
    const onError = vi.fn();
    const flags = createFeatureFlags(
      {
        // Nothing listens here: the client cannot fetch flags.
        UNLEASH_URL: 'http://127.0.0.1:9/api',
        UNLEASH_API_TOKEN: 'test-token',
        CATALOG_CACHE_ENABLED: false,
      },
      'test',
      onError,
    );

    try {
      expect(flags).toBeInstanceOf(UnleashFeatureFlags);
      expect(flags.isEnabled(Flag.CATALOG_CACHE_ENABLED)).toBe(false);
    } finally {
      flags.close();
    }
  });
});
