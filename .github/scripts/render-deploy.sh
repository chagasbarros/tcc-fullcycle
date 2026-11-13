#!/usr/bin/env bash
# Deploys one commit to one Render service and waits until it is live (ADR-0018).
#   1. calls the service's deploy hook with ?ref=<commit> (the hook URL is a secret);
#   2. polls <APP_URL>/health until "version" is that commit: Render only switches traffic
#      after the new instance passes its health check, so this means the deploy is done;
#   3. smoke test: GET /catalog/products must answer 200.
# Env: RENDER_DEPLOY_HOOK_URL, APP_URL, COMMIT_SHA, [TIMEOUT_SECONDS], [REQUIRE_LATEST_MAIN]
set -euo pipefail

: "${RENDER_DEPLOY_HOOK_URL:?missing secret RENDER_DEPLOY_HOOK_URL in this GitHub Environment}"
: "${APP_URL:?missing variable APP_URL in this GitHub Environment}"
: "${COMMIT_SHA:?}"
timeout="${TIMEOUT_SECONDS:-1200}" # free plan: build + boot can take several minutes

# Automatic deploys (REQUIRE_LATEST_MAIN=true) never ship an older commit than the tip of
# main: checked at the last moment, after any wait in the queue or for approval.
if [ "${REQUIRE_LATEST_MAIN:-false}" = "true" ]; then
  latest="$(git ls-remote origin refs/heads/main | cut -f1)"
  if [ -z "${latest}" ]; then
    echo "::error::Could not read the latest commit of main"
    exit 1
  fi
  if [ "${latest}" != "${COMMIT_SHA}" ]; then
    echo "::notice::Skipped: main moved to ${latest:0:7} while this job waited; not deploying the older ${COMMIT_SHA:0:7}."
    exit 0
  fi
fi

echo "Deploying ${COMMIT_SHA} to ${APP_URL}"
# The hook URL already has ?key=...; never echo it.
curl -fsS -o /dev/null -X POST "${RENDER_DEPLOY_HOOK_URL}&ref=${COMMIT_SHA}"

deadline=$((SECONDS + timeout))
while true; do
  # A sleeping free service takes ~1 min to wake up: generous per-request timeout.
  version="$(curl -fsS --max-time 90 "${APP_URL}/health" 2>/dev/null |
    sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)"
  if [ "${version}" = "${COMMIT_SHA}" ]; then
    echo "Live: ${APP_URL} is running ${version}"
    break
  fi
  if [ "${SECONDS}" -ge "${deadline}" ]; then
    echo "::error::Timed out after ${timeout}s; ${APP_URL} still runs '${version:-unreachable}'."
    echo "::error::Render keeps the previous version when the new one fails its health check; see the deploy logs on Render."
    exit 1
  fi
  echo "Waiting... live version: ${version:-unreachable}"
  sleep 20
done

status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "${APP_URL}/catalog/products")"
if [ "${status}" != "200" ]; then
  echo "::error::Smoke test failed: GET /catalog/products answered ${status}"
  exit 1
fi
echo "Smoke test passed: GET /catalog/products answered 200"
