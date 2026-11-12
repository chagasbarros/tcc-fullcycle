import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export type { PrismaClient };

export interface PrismaClientOptions {
  /** Size of this client's connection pool (pg's default is 10). */
  poolMax?: number;
}

export function createPrismaClient(
  databaseUrl: string,
  { poolMax }: PrismaClientOptions = {},
): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: poolMax }),
  });
}
