import { execSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

/**
 * Starts PostgreSQL 16 and Redis 7 once for the whole run and applies the real
 * migrations, so the tests run against the same schema as production.
 */
export default async function setup(project: TestProject) {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
  ]);

  const databaseUrl = postgres.getConnectionUri();
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'ignore',
  });

  project.provide('databaseUrl', databaseUrl);
  project.provide('redisUrl', `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`);

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
