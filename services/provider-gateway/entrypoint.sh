#!/bin/sh
set -eu
# Fly mounts a root-owned volume. Initialize only this service's subdirectory,
# then drop privileges before opening the listener or reading user requests.
mkdir -p /data/gateway
chown node:node /data/gateway
chmod 700 /data/gateway
exec su node -s /bin/sh -c 'umask 077; exec node /app/server.mjs'
