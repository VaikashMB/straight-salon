# 11 — Docker & Local Development

Goal for v1: **one command** (`docker compose up --build`) brings up the full stack locally. These images are written production-style (multi-stage, non-root, small) so they're reused unchanged in the later deployment / Kubernetes phase.

## 1. Services in `docker-compose.yml`

| Service | Image | Ports (host) | Purpose |
|---|---|---|---|
| `mongo` | `mongo:8.2` (see note below) | 27017 | DB, started with `--replSet rs0` |
| `mongo-init` | `mongo:8.2` | — | One-shot: `rs.initiate()` + create app user/roles (incl. append-only audit role), then exits |
| `redis` | `redis:7.4-alpine` | 6379 | Cache, rate limit, locks, BullMQ; `appendonly yes` |
| `backend` | built from `backend/Dockerfile` | 4000 | API (`node dist/server.js`) |
| `worker` | same Dockerfile/target as backend, tagged `straight-salon/worker:*` | — | `node dist/worker.js` (+ relay). No HTTP server, so its healthcheck is disabled. Own tag because two services exporting one tag in parallel fail with "image already exists"; the second build is a cache hit |
| `frontend` | built from `frontend/Dockerfile` | 3000 | Next.js standalone server |
| `mailpit` | `axllent/mailpit:v1.31` | 8025 (UI), 1025 (SMTP) | Catch-all email inbox for `EMAIL_PROVIDER=smtp` |
| `mongo-express` (profile `tools`) | `mongo-express:1.0-20-alpine3.19` | 8081 | DB browser |
| `redis-insight` (profile `tools`) | `redis/redisinsight:3.8` | 5540 | Redis browser |

SonarQube lives in a separate `docker-compose.sonar.yml` (it's heavy: needs ~2 GB RAM and `vm.max_map_count=262144` on Linux): `sonarqube:community` + `postgres:17-alpine`, its own project name and network.

> **Why `mongo:8.2` (2026-10):** MongoDB 8.0+ crashes on Linux kernels 6.19–7.0.13 (TCMalloc vs a kernel `rseq` change, SERVER-121912), so recent 8.0/8.3/9.0 builds refuse to start on kernel ≥ 6.19 unless it is ≥ 7.0.14. Ubuntu 26.04 kernels report `7.0.0-NN` even when built on upstream 7.0.14 (`cat /proc/version_signature`), so those builds refuse to start there too. The Ubuntu-aware check ships in 8.0.35 / 8.3.14 / 9.0.3 (SERVER-131779), which have no Docker images yet. `mongo:8.2` predates the guard and, on a fixed kernel (upstream ≥ 7.0.14), passed a 90 s write soak (the bug crashed at ~60 s). **On a kernel based on upstream 6.19–7.0.13, do not use 8.x; use `mongo:7.0` instead.** Move to `mongo:8.0` (≥ 8.0.35) when that image is published.

Image tags are pinned to a major/minor line (never `latest`), so `docker compose up` is reproducible; Dependabot (12 §1) proposes bumps.

## 2. Requirements for the compose file
- Named volumes: `mongo_data`, `redis_data`, `uploads_data` (app stack; `uploads_data` is mounted on the backend's `/app/backend/uploads`, which the runtime image pre-creates owned by 1000:1000 so the non-root API can write to it); `sonar_data`, `sonar_extensions`, `sonar_logs`, `sonar_db` (sonar file); `mongo_config` (auth overlay, holds the keyfile).
- Host ports bind to **127.0.0.1** only, so databases and tools are not reachable from the local network.
- Healthchecks: mongo (`mongosh --eval "db.adminCommand('ping')"`), redis (`redis-cli ping`), backend (`wget -qO- http://localhost:4000/health/ready`), frontend (`/` returns 200).
- `depends_on` with `condition: service_healthy` / `service_completed_successfully` (backend waits for mongo-init and redis).
- Environment from `.env` file (created with `npm run env:init`, which copies `.env.example` and generates the secrets; backend/worker refuse to start without `OUTBOX_ENCRYPTION_KEY`; `env_file` is optional, so the stack also starts without one). The frontend does **not** get `env_file`, so backend secrets never reach it. `.env.example` holds **host-mode** URLs (`localhost`); the compose file overrides the container-to-container ones with service names in each service's `environment:` (`MONGO_URI=mongodb://mongo:27017/straight_salon?replicaSet=rs0`, `REDIS_URL=redis://redis:6379`, `SMTP_HOST=mailpit`, `API_INTERNAL_URL=http://backend:4000`).
- Resource limits declared (`deploy.resources.limits`) to build the habit for Kubernetes later.
- The base file sets `NODE_ENV=production`, `PORT=4000` and `LOG_PRETTY=false` for backend/worker (runtime images have no dev dependencies, so no `pino-pretty`); the dev override sets `development` / `true`.
- One shared network `straight-salon`.

## 3. Development mode
`docker-compose.override.yml` (auto-loaded) for hot reload:
- backend/worker: target `dev` stage (image tag `straight-salon/backend:dev`), mount `./backend/src`, command `npx tsx watch src/server.ts` / `src/worker.ts`. Node inspector on 127.0.0.1:9229 for backend.
- frontend: target `dev`, mount `./frontend/src` and `./frontend/public`, `next dev --hostname 0.0.0.0`.
- Production-style images only: `docker compose -f docker-compose.yml up --build`.
Alternative: run only infra in Docker (`docker compose up mongo mongo-init redis mailpit`) and run apps on the host with `npm run dev`. Both must work.
Host mode needs `directConnection=true` in `MONGO_URI` (as in `.env.example`). The replica-set member is advertised as `mongo:27017`, a name the host cannot resolve; without it the driver would try to reconnect to that name and fail. Transactions and change streams still work on a single-node replica set with a direct connection.

## 4. Backend Dockerfile requirements (multi-stage)
Build context is the **repo root** (`build: { context: ., dockerfile: backend/Dockerfile }`), because npm workspaces keep a single
`package-lock.json` at the root. A backend-only context has no lockfile, so `npm ci` would fail.
```
Stage base   : node:24-alpine, WORKDIR /app
Stage base     : node:24-alpine, WORKDIR /app, copy root package.json + package-lock.json + .npmrc + backend/package.json
                 (+ frontend/package.json so the lockfile's workspace list resolves)
Stage deps     : npm ci -w backend --include-workspace-root=false --ignore-scripts
Stage dev      : from deps, copy tsconfig.base.json + backend source, CMD npx tsx watch src/server.ts
Stage build    : from deps, copy tsconfig.base.json + backend source, npm run build -w backend (tsc -> dist)
Stage prod-deps: from base, npm ci -w backend --include-workspace-root=false --omit=dev --ignore-scripts
                 (a clean production install; simpler and more reliable than `npm prune` inside a workspace)
Stage runtime  : node:24-alpine + tini, NODE_ENV=production, copy node_modules from prod-deps, dist from build, backend/package.json,
               run as non-root numeric user 1000:1000 (`node`; numeric so Kubernetes runAsNonRoot can verify it), EXPOSE 4000,
               HEALTHCHECK on /health/live,
               CMD ["node", "dist/server.js"]   # worker overrides command
```
- `--ignore-scripts`: images never run git hooks (Husky) or dependency install scripts; native packages resolve their prebuilt optional binaries.
- `.dockerignore` (repo root): node_modules, dist, .next, coverage, .env*, tests, .git, docs, infra, scripts.
- Use `tini` (or `--init`) as PID 1 so `SIGTERM` reaches Node for graceful shutdown.
- Image labels: `org.opencontainers.image.source`, `version`, `revision` (git SHA via build arg).

## 5. Frontend Dockerfile requirements
Multi-stage with Next.js `output: "standalone"`, built from the repo root context like the backend: deps (`npm ci -w frontend`) → build (`npm run build -w frontend`) → runtime on `node:24-alpine` copying `frontend/.next/standalone`, `frontend/.next/static`, `frontend/public`. Because `outputFileTracingRoot` is the repo root, the standalone server is at `frontend/server.js` inside the standalone folder. Non-root numeric user 1000:1000 with `.next` owned by it (ISR cache writes); `ENV HOSTNAME=0.0.0.0` (Docker sets `HOSTNAME` to the container ID, and the standalone server binds to it, which breaks the localhost healthcheck); tini as PID 1 with `-e 143` (Next's standalone server exits via the default SIGTERM action; tini maps 143 to a clean 0); `CMD ["node", "frontend/server.js"]`; `EXPOSE 3000`. `frontend/public/` must exist (it holds `robots.txt`).
`API_INTERNAL_URL` is passed at runtime, not baked at build time: the `/api/*` proxy lives in `proxy.ts` and reads the variable per request (05 §5). `next.config` `rewrites` cannot be used for this because they are fixed at build time. Avoid `NEXT_PUBLIC_*` for anything environment-specific except the base path.

## 6. Mongo init script (`infra/docker/mongo-init.js`)
Run by the one-shot `mongo-init` service on every `up`; idempotent.
1. `rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] })` if not initiated, then wait until the node is PRIMARY (`db.adminCommand({ hello: 1 })`).
2. When `MONGO_AUTH=true`: create/update role `auditAppendOnly` (`find`, `insert`, `createCollection`, `createIndex`, `listIndexes` on `straight_salon.audit_logs`; no update/remove/drop).
3. Create/update role `ssAppReadWrite`: read/write actions (`find`, `insert`, `update`, `remove`, `createCollection`, `createIndex`, `dropIndex`, `listIndexes`, `collMod`, `changeStream`) on every **listed** application collection (all of 02 §2 except `audit_logs`, plus migrate-mongo's `changelog`/`changelog_lock`), and `listCollections` on the database. A new collection must be added to this list.
4. Create/update user `ss_app` (password `MONGO_APP_PASSWORD`) with both roles. No `dropDatabase`, no `dropCollection`.
5. `MONGO_AUTH=false` (default local dev) skips 2–4.

**Auth mode** is the overlay `docker-compose.auth.yml`: sets the root user, generates a replica-set keyfile inside the container (0400, owned by mongodb), runs mongod with `--keyFile`, runs mongo-init as root, and gives backend/worker an `ss_app` URI. Switching an existing volume to auth needs `npm run reset` first.
Verified against a real auth-enabled replica set: `ss_app` can insert/find `audit_logs` (also inside a transaction with `bookings`) but update, delete and drop are rejected with `Unauthorized`.

## 7. Root npm scripts (Docker-related)
| Script | Does |
|---|---|
| `npm run up` | `docker compose up -d --build` |
| `npm run down` | `docker compose down` |
| `npm run reset` | `docker compose down -v` (wipes data) |
| `npm run logs` | `docker compose logs -f backend worker` |
| `npm run seed` | `docker compose exec backend npm run db:seed` (stub until Phase 3, when the seed exists) |
| `npm run tools` | `docker compose --profile tools up -d` |
| `npm run sonar:up` | `docker compose -f docker-compose.sonar.yml up -d` |

## 8. Local URLs (after `npm run up && npm run seed`)
- App: http://localhost:3000
- API: http://localhost:4000/api/v1
- Swagger UI: http://localhost:4000/api/docs
- Mailpit: http://localhost:8025
- Bull Board: http://localhost:4000/admin/queues (admin login required)
- Mongo Express: http://localhost:8081 (tools profile)
- SonarQube: http://localhost:9000

## 9. Not in v1 (reserved for deployment phase)
Kubernetes manifests/Helm in `infra/k8s`, image registry pushes, TLS/ingress, production secrets, managed Mongo/Redis, multi-replica setups. The compose file's service split (api / worker / frontend / mongo / redis) maps 1:1 to future Kubernetes Deployments/StatefulSets.
