import { inject } from 'vitest';
import {
  createPrismaClient,
  type PrismaClient,
  type PrismaClientOptions,
} from '../../src/shared/db/prisma.js';

export function testPrisma(options?: PrismaClientOptions): PrismaClient {
  return createPrismaClient(inject('databaseUrl'), options);
}

/** Empties every business table, so each test starts from a clean database. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE payments.payments, orders.order_items, orders.orders, catalog.products',
  );
}
