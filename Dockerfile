# VTS — single image: Fastify API + operator console
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages ./packages
COPY apps ./apps
RUN npm -w @vts/web run build

FROM node:22-alpine
RUN apk upgrade --no-cache
WORKDIR /app
ENV NODE_ENV=production PORT=4100 WEB_DIST=/app/apps/web/dist
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Runtime needs no package manager: drop npm/corepack (removes their bundled CVEs from the image)
RUN npm ci --omit=dev --no-audit --no-fund -w @vts/api -w @vts/shared && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /root/.npm
COPY packages/shared/src ./packages/shared/src
COPY apps/api/src ./apps/api/src
COPY apps/api/migrations ./apps/api/migrations
COPY apps/api/tsconfig.json ./apps/api/
COPY --from=build /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:4100/health || exit 1
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]
