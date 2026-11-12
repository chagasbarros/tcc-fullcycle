// Mixed load on the marketplace, focused on the catalog SLO (docs/slo.md).
//   ~80% GET /catalog/products?page=N   (the SLO route)
//   ~15% GET /catalog/products/{id}
//   ~5%  POST /orders                   (exercises stock reservation and the payment queue)
// 3 stages: ramp up -> sustain -> ramp down. Run it through `node k6/run.mjs <label>`.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://api:3000';
// 300 VUs: the load used in docs/desempenho.md (100 VUs did not stress the API).
const VUS = Number(__ENV.VUS || 300);
const PAGE_SIZE = 20;

// Only 2xx counts as success. A 409 (out of stock) would be a business answer, but with the
// products picked in setup() it should not happen; if it does, it shows up as an error.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }));

export const options = {
  stages: [
    { duration: __ENV.RAMP_UP || '1m', target: VUS },
    { duration: __ENV.SUSTAIN || '3m', target: VUS },
    { duration: __ENV.RAMP_DOWN || '1m', target: 0 },
  ],
  thresholds: {
    // The SLO itself: p95 < 200 ms and less than 1% errors on the catalog listing.
    'http_req_duration{name:GET /catalog/products}': ['p(95)<200'],
    'http_req_failed{name:GET /catalog/products}': ['rate<0.01'],
    // Other routes: no SLO, a looser bound (also makes k6 report them per route).
    'http_req_duration{name:GET /catalog/products/{id}}': ['p(95)<500'],
    'http_req_failed{name:GET /catalog/products/{id}}': ['rate<0.01'],
    'http_req_duration{name:POST /orders}': ['p(95)<500'],
    'http_req_failed{name:POST /orders}': ['rate<0.01'],
    // Whole test: less than 1% errors on any route.
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  // Creating products on a remote environment (PREPARE_PRODUCTS) can take a while.
  setupTimeout: '3m',
};

// For an empty environment (e.g. staging on Render, which has no seed): creates products
// through the API until the catalog has PREPARE_PRODUCTS of them. Off by default.
function prepareProducts(target) {
  const total = http.get(`${BASE_URL}/catalog/products?pageSize=1`).json().total;
  const missing = target - total;
  for (let created = 0; created < missing; created += 20) {
    const batch = [];
    for (let i = created; i < Math.min(created + 20, missing); i++) {
      batch.push([
        'POST',
        `${BASE_URL}/catalog/products`,
        JSON.stringify({
          name: `k6 product ${total + i + 1}`,
          priceInCents: 1000 + i,
          stock: 100000,
        }),
        { headers: { 'Content-Type': 'application/json' }, tags: { name: 'setup' } },
      ]);
    }
    http.batch(batch);
  }
  if (missing > 0) console.log(`created ${missing} products (catalog had ${total})`);
}

// Runs once: reads how many pages exist and collects product ids with enough stock for orders.
export function setup() {
  const prepare = Number(__ENV.PREPARE_PRODUCTS || 0);
  if (prepare > 0) prepareProducts(prepare);
  const first = http.get(`${BASE_URL}/catalog/products?page=1&pageSize=100`).json();
  const pages = Math.ceil(first.total / PAGE_SIZE);
  const productIds = [];
  for (let page = 1; page <= 10; page++) {
    const body = http.get(`${BASE_URL}/catalog/products?page=${page}&pageSize=100`).json();
    for (const product of body.items) {
      if (product.stock >= 100) productIds.push(product.id);
    }
  }
  return { pages, productIds };
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export default function (data) {
  const roll = Math.random();

  if (roll < 0.8) {
    const page = 1 + Math.floor(Math.random() * data.pages);
    const res = http.get(`${BASE_URL}/catalog/products?page=${page}&pageSize=${PAGE_SIZE}`, {
      tags: { name: 'GET /catalog/products' },
    });
    check(res, { 'list 200': (r) => r.status === 200 });
  } else if (roll < 0.95) {
    const res = http.get(`${BASE_URL}/catalog/products/${pick(data.productIds)}`, {
      tags: { name: 'GET /catalog/products/{id}' },
    });
    check(res, { 'get 200': (r) => r.status === 200 });
  } else {
    const body = JSON.stringify({
      customerId: crypto.randomUUID(),
      paymentMethod: Math.random() < 0.5 ? 'CARD' : 'PIX',
      items: [{ productId: pick(data.productIds), quantity: 1 }],
    });
    const res = http.post(`${BASE_URL}/orders`, body, {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      tags: { name: 'POST /orders' },
    });
    check(res, { 'order 201': (r) => r.status === 201 });
  }

  // Think time between 0.1 s and 0.5 s: a user does not click non-stop.
  sleep(0.1 + Math.random() * 0.4);
}

// Saves the full summary next to the default text output, for docs/desempenho.md.
export function handleSummary(data) {
  const label = __ENV.LABEL || 'run';
  return {
    stdout: textSummary(data),
    [`/k6/results/${label}.json`]: JSON.stringify(data, null, 2),
  };
}

// Short summary: p95, RPS and error rate per route, which is what the report needs.
function textSummary(data) {
  const lines = [`\n== ${__ENV.LABEL || 'run'} ==`];
  const rps = data.metrics.http_reqs.values.rate;
  const failed = data.metrics.http_req_failed.values.rate;
  lines.push(`total: ${rps.toFixed(1)} req/s, errors ${(failed * 100).toFixed(2)}%`);
  for (const name of ['GET /catalog/products', 'GET /catalog/products/{id}', 'POST /orders']) {
    const duration = data.metrics[`http_req_duration{name:${name}}`];
    const errors = data.metrics[`http_req_failed{name:${name}}`];
    if (!duration) continue;
    const v = duration.values;
    lines.push(
      `${name.padEnd(28)} p95 ${v['p(95)'].toFixed(1)} ms | p99 ${v['p(99)'].toFixed(1)} ms | ` +
        `med ${v.med.toFixed(1)} ms | errors ${errors ? (errors.values.rate * 100).toFixed(2) : '-'}%`,
    );
  }
  for (const [name, threshold] of Object.entries(data.metrics)) {
    if (!threshold.thresholds) continue;
    for (const [rule, result] of Object.entries(threshold.thresholds)) {
      lines.push(`threshold ${name} ${rule}: ${result.ok ? 'OK' : 'FAILED'}`);
    }
  }
  return lines.join('\n') + '\n';
}
