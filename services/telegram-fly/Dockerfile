FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production
COPY dist/server.mjs ./server.mjs
EXPOSE 8080
CMD ["node", "server.mjs"]
