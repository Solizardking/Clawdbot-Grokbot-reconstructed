#!/bin/sh
set -eu
if [ -z "${SAND_GATEWAY_TOKEN:-}" ] || [ -z "${SAND_HOSTED_GATEWAY_TOKEN:-}" ]; then
  echo 'Runtime requires its owner gateway credentials.' >&2
  exit 1
fi
mkdir -p /data/sand-data /data/chromium
chown -R node:node /data
exec setpriv --reuid=node --regid=node --init-groups sh -c '
  Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
  exec node /app/host/host-main.cjs
'
