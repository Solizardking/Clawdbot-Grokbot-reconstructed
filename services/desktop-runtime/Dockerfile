FROM node:26.5.0-bookworm-slim AS native
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY runtime/tree-sitter.binding.gyp node_modules/tree-sitter/binding.gyp
RUN node node_modules/node-gyp/bin/node-gyp.js rebuild --directory node_modules/tree-sitter --release \
 && node node_modules/node-gyp/bin/node-gyp.js rebuild --directory node_modules/tree-sitter-bash --release \
 && node -e 'const Parser=require("tree-sitter");const parser=new Parser();parser.setLanguage(require("tree-sitter-bash"));parser.parse("echo ready");'

FROM node:26.5.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends bash git curl ca-certificates procps python3 util-linux \
      chromium xvfb x11-utils xdotool imagemagick \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=native /app/node_modules /app/node_modules
COPY runtime/host /app/host
COPY runtime/box-exec-daemon /app/box-exec-daemon
COPY runtime/inventory.json /app/runtime-inventory.json
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod 755 /app/entrypoint.sh
ENV NODE_ENV=production SAND_PACKAGED=1 SAND_DATA_ROOT=/data/sand-data \
    SAND_TREE_SITTER_NODE_DEPS=/app/node_modules SAND_GATEWAY_BIND_HOST=0.0.0.0 \
    SAND_HOST_PORT=1340 SAND_DISABLE_SENTRY=1 DISPLAY=:99
EXPOSE 1340
ENTRYPOINT ["/app/entrypoint.sh"]
