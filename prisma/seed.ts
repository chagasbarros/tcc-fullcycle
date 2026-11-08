/**
 * Synthetic data for load tests (CLAUDE.md, section 5): `npm run db:seed`.
 *
 * - Reproducible: fixed faker seed, and even the UUID v7 ids are deterministic
 *   (timestamp from the generated date + "random" bytes from faker).
 * - Fast: writes straight to each module's tables with createMany in batches,
 *   bypassing use cases and the queue (going through them would take hours).
 * - Consistent with the business rules: statuses follow the fake providers
 *   (ADR-0011) and only PAID / PAYMENT_FAILED orders have a payment.
 *
 * Wipes all business tables first. Refuses to run in production.
 */
import { fakerPT_BR as faker } from '@faker-js/faker';
import { v7 } from 'uuid';
import { loadEnv } from '../src/shared/config/env.js';
import { createPrismaClient } from '../src/shared/db/prisma.js';

const SEED = 20261113; // delivery date: same input -> same data
const PRODUCTS = 5_000;
const CUSTOMERS = 20_000;
const ORDERS = 100_000;
const BATCH = 5_000;
const DAY = 24 * 60 * 60 * 1000;

type Method = 'CARD' | 'PIX';
type Status = 'PENDING_PAYMENT' | 'PAID' | 'PAYMENT_FAILED' | 'CANCELLED';

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  throw new Error('db:seed wipes the database and must not run in production');
}
const prisma = createPrismaClient(env.DATABASE_URL);
faker.seed(SEED);

const started = Date.now();
const log = (message: string) =>
  console.log(`[seed ${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);

/** Deterministic UUID v7 for a given moment. */
function idAt(msecs: number): string {
  const random = Uint8Array.from({ length: 16 }, () => faker.number.int(255));
  return v7({ msecs, random });
}

async function inBatches<T>(label: string, rows: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await insert(rows.slice(i, i + BATCH));
    log(
      `${label}: ${Math.min(i + BATCH, rows.length).toLocaleString('pt-BR')}/${rows.length.toLocaleString('pt-BR')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 1. Generate everything in memory
// ---------------------------------------------------------------------------
// Fixed reference date (not Date.now()), otherwise running on another day changes the data.
const now = Date.UTC(2026, 10, 1); // 2026-11-01
const yearAgo = now - 365 * DAY;

const products = Array.from({ length: PRODUCTS }, () => ({
  id: idAt(yearAgo - faker.number.int(30 * DAY)),
  name: faker.commerce.productName().slice(0, 200),
  priceInCents: faker.number.int({ min: 500, max: 500_000 }),
  stock: faker.number.int({ min: 0, max: 1_000 }),
}));

const customerIds = Array.from({ length: CUSTOMERS }, () =>
  idAt(yearAgo - faker.number.int(30 * DAY)),
);

// Orders spread over the last 12 months, in time order (so v7 ids are time-ordered too).
const orderTimes = Array.from({ length: ORDERS }, () =>
  faker.number.int({ min: yearAgo, max: now }),
).sort((a, b) => a - b);

const orders: {
  id: string;
  customerId: string;
  status: Status;
  paymentMethod: Method;
  totalInCents: number;
  createdAt: Date;
}[] = [];
const items: {
  orderId: string;
  productId: string;
  productName: string;
  unitPriceInCents: number;
  quantity: number;
}[] = [];
const payments: {
  id: string;
  orderId: string;
  method: Method;
  amountInCents: number;
  status: 'APPROVED' | 'DECLINED';
  declineReason: string | null;
  createdAt: Date;
}[] = [];

for (const createdAtMs of orderTimes) {
  const orderId = idAt(createdAtMs);
  const chosen = faker.helpers.arrayElements(products, { min: 1, max: 5 });
  let totalInCents = 0;
  for (const product of chosen) {
    const quantity = faker.number.int({ min: 1, max: 3 });
    totalInCents += product.priceInCents * quantity;
    items.push({
      orderId,
      productId: product.id,
      productName: product.name,
      unitPriceInCents: product.priceInCents,
      quantity,
    });
  }

  const paymentMethod: Method = faker.helpers.weightedArrayElement([
    { value: 'CARD', weight: 7 },
    { value: 'PIX', weight: 3 },
  ]);

  // ~5% cancelled; orders from the last hour before the reference date may still be waiting;
  // the rest follow the fake providers' rule (card declines amounts ending in 13).
  let status: Status;
  if (faker.number.float() < 0.05) {
    status = 'CANCELLED';
  } else if (now - createdAtMs < 60 * 60 * 1000) {
    status = 'PENDING_PAYMENT';
  } else if (paymentMethod === 'CARD' && totalInCents % 100 === 13) {
    status = 'PAYMENT_FAILED';
  } else {
    status = 'PAID';
  }

  const createdAt = new Date(createdAtMs);
  orders.push({
    id: orderId,
    customerId: faker.helpers.arrayElement(customerIds),
    status,
    paymentMethod,
    totalInCents,
    createdAt,
  });

  if (status === 'PAID' || status === 'PAYMENT_FAILED') {
    const paidAt = createdAtMs + faker.number.int({ min: 200, max: 5_000 });
    payments.push({
      id: idAt(paidAt),
      orderId,
      method: paymentMethod,
      amountInCents: totalInCents,
      status: status === 'PAID' ? 'APPROVED' : 'DECLINED',
      declineReason: status === 'PAID' ? null : 'card declined (amount ends in 13 cents)',
      createdAt: new Date(paidAt),
    });
  }
}
log(
  `generated ${products.length} products, ${customerIds.length} customers, ` +
    `${orders.length} orders, ${items.length} items, ${payments.length} payments`,
);

// ---------------------------------------------------------------------------
// 2. Wipe and insert (each module's own tables; no cross-schema relations)
// ---------------------------------------------------------------------------
await prisma.$executeRawUnsafe(
  'TRUNCATE payments.payments, orders.order_items, orders.orders, catalog.products',
);
log('tables truncated');

await inBatches('products', products, (batch) => prisma.product.createMany({ data: batch }));
await inBatches('orders', orders, (batch) => prisma.order.createMany({ data: batch }));
await inBatches('order items', items, (batch) => prisma.orderItem.createMany({ data: batch }));
await inBatches('payments', payments, (batch) => prisma.payment.createMany({ data: batch }));

// Fresh statistics so EXPLAIN ANALYZE (k6 analysis) sees the real table sizes.
await prisma.$executeRawUnsafe('ANALYZE');

const byStatus = await prisma.order.groupBy({
  by: ['status'],
  _count: true,
  orderBy: { status: 'asc' },
});
log(`orders by status: ${byStatus.map((s) => `${s.status}=${s._count}`).join(', ')}`);
log('done');
await prisma.$disconnect();
