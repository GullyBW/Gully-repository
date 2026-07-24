# NJTIP MVP — production container (SYNTHETIC data only; zero runtime dependencies).
# Multi-stage-free because there is nothing to build; we ship the source + the Twin
# it validates against. Runs as non-root with a read-only-friendly layout.
FROM node:22-alpine AS base

# The app validates against the Twin at runtime (GET /api/twin/validate, /readyz),
# so both packages are copied. No `npm install` — there are no dependencies.
WORKDIR /srv
COPY njtip-twin/ ./njtip-twin/
COPY njtip-app/ ./njtip-app/

# Non-root user; writable data dir for file persistence (a volume in production).
RUN addgroup -S njtip && adduser -S njtip -G njtip \
  && mkdir -p /srv/njtip-app/data && chown -R njtip:njtip /srv
USER njtip
WORKDIR /srv/njtip-app

ENV PORT=8087 NJTIP_MODE=production-shaped NJTIP_PERSISTENCE=file NJTIP_DATA_DIR=/srv/njtip-app/data
EXPOSE 8087

# Liveness/readiness via the app's own endpoints.
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8087/healthz || exit 1

# Fail fast if architecture invariants are violated, then start.
CMD ["sh", "-c", "node scripts/assure.js && node src/server.js"]
