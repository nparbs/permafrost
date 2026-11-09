# Builds the game page and the server, then runs both from one small image.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server/index.mjs ./index.mjs
# The named volume copies this folder's owner on first use, so the node user can write the world.
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=8791 STATIC_DIR=/app/dist DB_FILE=/data/permafrost.db
USER node
EXPOSE 8791
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "index.mjs"]
