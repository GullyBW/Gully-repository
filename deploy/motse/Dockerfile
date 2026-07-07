# Motse production image (Phase 2, WS3).
# Build from the REPO ROOT:  docker build -f deploy/motse/Dockerfile -t motse-core .
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund

FROM node:22-alpine
RUN addgroup -S motse && adduser -S motse -G motse \
    && apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production \
    MOTSE_PORT=4100 \
    MOTSE_LOG_LEVEL=info
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY motse ./motse
USER motse
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4100/health || exit 1
CMD ["node", "motse/src/server.js"]
