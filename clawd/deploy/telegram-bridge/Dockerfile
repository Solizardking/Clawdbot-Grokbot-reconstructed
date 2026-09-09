FROM node:22-slim
WORKDIR /app
COPY server.cjs ./server.cjs
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server.cjs"]
