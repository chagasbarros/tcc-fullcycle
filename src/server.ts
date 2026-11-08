import { buildApp } from './app.js';
import { createCatalogModule, PrismaProductRepository } from './modules/catalog/index.js';
import { loadEnv } from './shared/config/env.js';
import { createPrismaClient } from './shared/db/prisma.js';
import { newId } from './shared/ids.js';

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);

// Composition: this is the only place that decides which implementations are used.
const catalog = createCatalogModule({
  productRepository: new PrismaProductRepository(prisma),
  newId,
});

const app = await buildApp({ env, catalog });
app.addHook('onClose', () => prisma.$disconnect());

// Graceful shutdown: stop accepting requests and finish the in-flight ones.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error(error, 'error during shutdown');
        process.exit(1);
      },
    );
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
