# syntax=docker/dockerfile:1
# Backend image (api, worker and relay share it; the command selects the process).
# Build context: repository root, because npm workspaces keep one package-lock.json there.
#   docker build -f backend/Dockerfile --target runtime .
# Spec: docs/specs/11-docker-local-dev.md §4.

ARG NODE_IMAGE=node:24-alpine

# ---- base: shared settings -------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
# Only the manifests the lockfile needs: root + both workspaces (frontend deps are not installed).
COPY package.json package-lock.json .npmrc ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# ---- deps: all backend dependencies (dev + prod) ---------------------------------------
# --ignore-scripts: no git hooks in images; native packages ship prebuilt optional binaries.
FROM base AS deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace backend --include-workspace-root=false --ignore-scripts

# ---- dev: hot reload (docker-compose.override.yml mounts backend/src) ------------------
FROM deps AS dev
COPY tsconfig.base.json ./
COPY backend/ backend/
RUN mkdir -p /app/backend/uploads
WORKDIR /app/backend
EXPOSE 4000 9229
CMD ["npx", "tsx", "watch", "src/server.ts"]

# ---- build: compile TypeScript to dist/ ------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY backend/ backend/
RUN npm run build --workspace backend

# ---- prod-deps: production dependencies only -------------------------------------------
FROM base AS prod-deps
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace backend --include-workspace-root=false --omit=dev --ignore-scripts \
    && mkdir -p backend/node_modules

# ---- runtime: small, non-root, tini as PID 1 -------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="straight-salon-backend" \
      org.opencontainers.image.source="https://github.com/VaikashMB/straight-salon" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"
# Unpinned on purpose: exact Alpine package versions disappear from the mirror on update.
# hadolint ignore=DL3018
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/package.json
# Upload directory for the local ObjectStorage adapter (API-027). Created here, owned by the
# runtime user, so a named volume mounted on it starts with the right ownership.
RUN mkdir -p /app/backend/uploads && chown 1000:1000 /app/backend/uploads
WORKDIR /app/backend
# Numeric UID of the image's `node` user, so Kubernetes runAsNonRoot can verify it.
USER 1000:1000
EXPOSE 4000
# Liveness only; compose (and later Kubernetes) probes /health/ready for readiness.
# Shell form so ${PORT} expands at runtime.
# hadolint ignore=DL3025
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT:-4000}/health/live" || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
