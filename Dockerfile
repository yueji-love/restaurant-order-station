# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN npm ci --registry=${NPM_REGISTRY}

COPY index.html vite.config.js pwa-assets.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NODE_ENV=production \
    PORT=5175

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --registry=${NPM_REGISTRY} \
    && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data

USER node
EXPOSE 5175
VOLUME ["/app/server/data"]

CMD ["node", "server/index.js"]
