# syntax=docker/dockerfile:1
# Frontend image: Next.js standalone server.
# Build context: repository root, because npm workspaces keep one package-lock.json there.
#   docker build -f frontend/Dockerfile --target runtime .
# Spec: docs/specs/11-docker-local-dev.md §5.

ARG NODE_IMAGE=node:24-alpine

# ---- base: shared settings -------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# ---- deps: frontend dependencies -------------------------------------------------------
FROM base AS deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace frontend --include-workspace-root=false --ignore-scripts

# ---- dev: hot reload (docker-compose.override.yml mounts frontend/src) -----------------
FROM deps AS dev
COPY tsconfig.base.json ./
COPY frontend/ frontend/
WORKDIR /app/frontend
EXPOSE 3000
CMD ["npx", "next", "dev", "--hostname", "0.0.0.0"]

# ---- build: next build (output: standalone, traced from the repo root) -----------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY frontend/ frontend/
RUN npm run build --workspace frontend

# ---- runtime: small, non-root, tini as PID 1 -------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="straight-salon-frontend" \
      org.opencontainers.image.source="https://github.com/VaikashMB/straight-salon" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"
# Unpinned on purpose: exact Alpine package versions disappear from the mirror on update.
# hadolint ignore=DL3018
RUN apk add --no-cache tini
# HOSTNAME must be 0.0.0.0: Docker sets it to the container ID, and the standalone server
# would otherwise bind only to that address (breaking the localhost healthcheck).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# .next must be writable by the runtime user (ISR / image cache).
COPY --from=build --chown=1000:1000 /app/frontend/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public
# Numeric UID of the image's `node` user, so Kubernetes runAsNonRoot can verify it.
USER 1000:1000
EXPOSE 3000
# Shell form so ${PORT} expands at runtime.
# hadolint ignore=DL3025
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/" || exit 1
# Next's standalone server exits via the default SIGTERM action (code 143); tini -e maps that
# to 0 so orchestrators see a clean stop.
ENTRYPOINT ["/sbin/tini", "-e", "143", "--"]
# API_INTERNAL_URL is read at runtime (05-frontend §5), never baked in at build time.
CMD ["node", "frontend/server.js"]
