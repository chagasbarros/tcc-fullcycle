import { Unleash } from 'unleash-client';

/** Every flag of the system. A typo becomes a compile error, not a silently-off flag. */
export const Flag = {
  /** Kill switch of the catalog cache (cache-aside in Redis). */
  CATALOG_CACHE_ENABLED: 'catalog-cache-enabled',
} as const;
export type Flag = (typeof Flag)[keyof typeof Flag];

/**
 * Port for feature flags. Code asks "is X on?" and does not know where the answer
 * comes from: Unleash locally (toggle live in the UI) or an env var on Render (ADR-0015).
 * isEnabled is synchronous: it is called on every request and must not add latency.
 */
export interface FeatureFlags {
  isEnabled(flag: Flag): boolean;
  close(): void;
}

/** Value used when a flag is not configured anywhere (or Unleash is unreachable). */
export type FlagDefaults = Record<Flag, boolean>;

/** Flags from env vars, e.g. catalog-cache-enabled <- CATALOG_CACHE_ENABLED. Fixed until restart. */
export class EnvFeatureFlags implements FeatureFlags {
  constructor(private readonly values: FlagDefaults) {}

  isEnabled(flag: Flag): boolean {
    return this.values[flag];
  }

  close(): void {}
}

export interface UnleashFlagsConfig {
  url: string;
  apiToken: string;
  appName: string;
  defaults: FlagDefaults;
  onError: (error: Error) => void;
}

/**
 * Flags from an Unleash server. The SDK polls the server in the background and keeps the
 * flags in memory, so isEnabled never waits for the network. If Unleash is down or the flag
 * does not exist, the default is used: the app keeps working.
 */
export class UnleashFeatureFlags implements FeatureFlags {
  private readonly client: Unleash;

  constructor(private readonly config: UnleashFlagsConfig) {
    this.client = new Unleash({
      url: config.url,
      appName: config.appName,
      customHeaders: { Authorization: config.apiToken },
      refreshInterval: 5_000, // a toggle in the UI takes effect within ~5 s
    });
    // An EventEmitter 'error' without a listener would crash the process.
    this.client.on('error', config.onError);
  }

  isEnabled(flag: Flag): boolean {
    return this.client.isEnabled(flag, undefined, this.config.defaults[flag]);
  }

  close(): void {
    this.client.destroy();
  }
}
