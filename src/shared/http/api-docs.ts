import { dirname, resolve } from 'node:path';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

/** The single API contract (CLAUDE.md, section 4). Relative to the working directory. */
const OPENAPI_PATH = resolve(process.cwd(), 'docs/openapi.yaml');

/**
 * Swagger UI at /docs, serving docs/openapi.yaml as it is ("static" mode).
 * The hand-written file is the contract; nothing is generated from code, so
 * what Spectral lints is exactly what the UI shows.
 */
export async function registerApiDocs(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    mode: 'static',
    specification: { path: OPENAPI_PATH, baseDir: dirname(OPENAPI_PATH) },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
}
