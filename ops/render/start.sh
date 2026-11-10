#!/bin/sh
# Render free plan has no pre-deploy command (ADR-0018): apply pending migrations, then start.
# If a migration fails, the server never starts, the health check fails and Render keeps the
# previous version live.
set -eu
node node_modules/prisma/build/index.js migrate deploy
exec node --import ./dist/instrumentation.js dist/server.js
