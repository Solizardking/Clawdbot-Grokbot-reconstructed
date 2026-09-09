# Template only. `server.cjs` is not in this folder.
# Stage it, then deploy the generated directory:
#   npm run build:bridge && cd .build/telegram-bridge && fly deploy
FROM node:22-slim
WORKDIR /app
COPY server.cjs ./server.cjs
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server.cjs"]
