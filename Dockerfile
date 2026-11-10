# ---- build: install all deps and compile TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# prisma.config.ts requires DATABASE_URL to load; generate does not connect, so a placeholder is enough.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate && npm run build

# ---- runtime: production deps + compiled JS only ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# npm is only needed for this install. The runtime runs `node`, so npm/npx, corepack and
# yarn are removed: less attack surface, and Trivy flagged HIGH CVEs in npm's own bundled deps.
RUN npm ci --omit=dev \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
     /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
     /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build /app/dist ./dist
# The API contract served by the Swagger UI at /docs.
COPY docs/openapi.yaml ./docs/openapi.yaml
# Schema + migrations + start script: on Render, migrations run at container start (ADR-0018).
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY ops/render/start.sh ./start-with-migrations.sh
USER node
EXPOSE 3000
# --import loads OpenTelemetry before the app (it only turns on if OTEL_EXPORTER_OTLP_ENDPOINT is set).
CMD ["node", "--import", "./dist/instrumentation.js", "dist/server.js"]
