import { buildApp } from './app.js';
import { loadEnv } from './shared/config/env.js';

const env = loadEnv();
const app = await buildApp(env);

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
