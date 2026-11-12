// Runs k6/marketplace.js against the local compose stack, in Docker (no k6 install needed).
//   node k6/run.mjs <label> [--cache on|off]
// --cache switches the catalog-cache-enabled flag in the local Unleash first, then waits
// for the API to pick it up (it polls Unleash every ~5 s, ADR-0015).
// Extra settings go through env vars: VUS, RAMP_UP, SUSTAIN, RAMP_DOWN, and for a remote
// environment BASE_URL (default: the compose api) and PREPARE_PRODUCTS (see marketplace.js).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const K6_IMAGE = 'grafana/k6:1.0.0';
const NETWORK = 'tcc-fullcycle_default'; // compose network, so k6 reaches http://api:3000
// Local-only admin token, defined in docker-compose.yml (never used outside the compose).
const UNLEASH = 'http://localhost:4242/api/admin/projects/default/features/catalog-cache-enabled';
const UNLEASH_TOKEN = '*:*.local-dev-admin-token';

const label = process.argv[2];
const cacheIndex = process.argv.indexOf('--cache');
const cache = cacheIndex > 0 ? process.argv[cacheIndex + 1] : undefined;
if (!label || (cache && !['on', 'off'].includes(cache))) {
  console.error('usage: node k6/run.mjs <label> [--cache on|off]');
  process.exit(2);
}

if (cache) {
  const res = await fetch(`${UNLEASH}/environments/development/${cache}`, {
    method: 'POST',
    headers: { Authorization: UNLEASH_TOKEN },
  });
  if (!res.ok) throw new Error(`Unleash answered ${res.status} switching the flag ${cache}`);
  console.log(`catalog-cache-enabled = ${cache}; waiting 10 s for the API to pick it up`);
  await new Promise((done) => setTimeout(done, 10_000));
}

const k6Dir = dirname(fileURLToPath(import.meta.url));
mkdirSync(resolve(k6Dir, 'results'), { recursive: true });

const env = ['BASE_URL', 'PREPARE_PRODUCTS', 'VUS', 'RAMP_UP', 'SUSTAIN', 'RAMP_DOWN'].flatMap(
  (name) => (process.env[name] ? ['-e', `${name}=${process.env[name]}`] : []),
);
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--network',
    NETWORK,
    '-v',
    `${k6Dir}:/k6`,
    '-e',
    `LABEL=${label}`,
    ...env,
    K6_IMAGE,
    'run',
    '--quiet',
    '/k6/marketplace.js',
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
