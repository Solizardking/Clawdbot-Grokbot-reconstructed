FROM node:26.5.0-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server.mjs ./server.mjs
COPY --chown=node:node wallet-access.mjs ./wallet-access.mjs
COPY --chown=node:node store.mjs ./store.mjs
COPY --chown=node:node pump.mjs ./pump.mjs
COPY --chown=node:node market.mjs ./market.mjs
COPY --chown=node:node composio.mjs ./composio.mjs
COPY --chown=node:node tavily.mjs ./tavily.mjs
COPY --chown=node:node birdeye.mjs ./birdeye.mjs
COPY --chown=node:node helius.mjs ./helius.mjs
COPY --chown=node:node solana-tracker.mjs ./solana-tracker.mjs
COPY --chown=node:node browser-use.mjs ./browser-use.mjs
COPY --chown=node:node e2b.mjs ./e2b.mjs
COPY --chown=node:node media.mjs ./media.mjs
COPY --chown=node:node runtime.mjs ./runtime.mjs
COPY --chmod=755 entrypoint.sh ./entrypoint.sh
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
ENTRYPOINT ["./entrypoint.sh"]
