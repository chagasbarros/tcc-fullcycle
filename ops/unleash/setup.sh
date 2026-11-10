#!/bin/sh
# Creates the catalog-cache-enabled flag in the local Unleash, turned ON in "development".
# Runs once per `docker compose up` (unleash-setup service) and is safe to re-run.
set -eu

API="${UNLEASH_ADMIN_URL:?}/api/admin/projects/default/features"
AUTH="Authorization: ${UNLEASH_ADMIN_TOKEN:?}"
FLAG="catalog-cache-enabled"

if curl -fs -o /dev/null -H "$AUTH" "$API/$FLAG"; then
  echo "flag $FLAG already exists, leaving it as it is"
  exit 0
fi

echo "creating flag $FLAG"
curl -fsS -o /dev/null -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$FLAG\",\"type\":\"kill-switch\",\"description\":\"Liga/desliga o cache do catálogo (ADR-0014, ADR-0015)\"}" \
  "$API"
# "default" strategy = on for everyone, then switch the environment on.
curl -fsS -o /dev/null -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"default"}' "$API/$FLAG/environments/development/strategies"
curl -fsS -o /dev/null -X POST -H "$AUTH" "$API/$FLAG/environments/development/on"
echo "flag $FLAG created and ON in development"
