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
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
