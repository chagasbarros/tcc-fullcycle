import type { Env } from '../config/env.js';
import {
  EnvFeatureFlags,
  Flag,
  UnleashFeatureFlags,
  type FeatureFlags,
  type FlagDefaults,
} from './feature-flags.js';

type FlagsEnv = Pick<Env, 'UNLEASH_URL' | 'UNLEASH_API_TOKEN' | 'CATALOG_CACHE_ENABLED'>;

/** Picks the flag source: Unleash if configured (local compose), env vars otherwise (Render). */
export function createFeatureFlags(
  env: FlagsEnv,
  appName: string,
  onError: (error: Error) => void,
): FeatureFlags {
  const defaults: FlagDefaults = { [Flag.CATALOG_CACHE_ENABLED]: env.CATALOG_CACHE_ENABLED };

  if (env.UNLEASH_URL && env.UNLEASH_API_TOKEN) {
    return new UnleashFeatureFlags({
      url: env.UNLEASH_URL,
      apiToken: env.UNLEASH_API_TOKEN,
      appName,
      defaults,
      onError,
    });
  }
  return new EnvFeatureFlags(defaults);
}
