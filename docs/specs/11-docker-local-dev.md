# 11 — Docker & Local Development

Goal for v1: **one command** (`docker compose up --build`) brings up the full stack locally. These images are written production-style (multi-stage, non-root, small) so they're reused unchanged in the later deployment / Kubernetes phase.

## 1. Services in `docker-compose.yml`

| Service | Image | Ports (host) | Purpose |
|---|---|---|---|
| `mongo` | `mongo:8.0` | 27017 | DB, started with `--replSet rs0` |
| `mongo-init` | `mongo:8.0` | — | One-shot: `rs.initiate()` + create app user/roles (incl. append-only audit role), then exits |
| `redis` | `redis:7-alpine` | 6379 | Cache, rate limit, locks, BullMQ; `appendonly yes` |
| `backend` | built from `backend/Dockerfile` | 4000 | API (`node dist/server.js`) |
| `worker` | same image as backend | — | `node dist/worker.js` (+ relay) |
| `frontend` | built from `frontend/Dockerfile` | 3000 | Next.js standalone server |
| `mailpit` | `axllent/mailpit` | 8025 (UI), 1025 (SMTP) | Catch-all email inbox for `EMAIL_PROVIDER=smtp` |
| `mongo-express` (profile `tools`) | `mongo-express` | 8081 | DB browser |
| `redis-insight` (profile `tools`) | `redis/redisinsight` | 5540 | Redis browser |

SonarQube lives in a separate `docker-compose.sonar.yml` (it's heavy: needs ~2 GB RAM and `vm.max_map_count=262144` on Linux).

## 2. Requirements for the compose file
- Named volumes: `mongo_data`, `redis_data`, `sonar_data`, `sonar_db`.
- Healthchecks: mongo (`mongosh --eval "db.adminCommand('ping')"`), redis (`redis-cli ping`), backend (`wget -qO- http://localhost:4000/health/ready`), frontend (`/` returns 200).
- `depends_on` with `condition: service_healthy` / `service_completed_successfully` (backend waits for mongo-init and redis).
- Environment from `.env` file (copied from `.env.example`). `.env.example` holds **host-mode** URLs (`localhost`); the compose file overrides the container-to-container ones with service names in each service's `environment:` (`MONGO_URI=mongodb://mongo:27017/straight_salon?replicaSet=rs0`, `REDIS_URL=redis://redis:6379`, `SMTP_HOST=mailpit`, `API_INTERNAL_URL=http://backend:4000`).
- Resource limits declared (`deploy.resources.limits`) to build the habit for Kubernetes later.
- One shared network `straight-salon`.

## 3. Development mode
`docker-compose.override.yml` (auto-loaded) for hot reload:
- backend/worker: target `dev` stage, mount `./backend/src`, command `npm run dev` (tsx watch). Node inspector on 9229 for backend.
- frontend: target `dev`, mount `./frontend/src`, `npm run dev`.
Alternative: run only infra in Docker (`docker compose up mongo mongo-init redis mailpit`) and run apps on the host with `npm run dev`. Both must work.
Host mode needs `directConnection=true` in `MONGO_URI` (as in `.env.example`). The replica-set member is advertised as `mongo:27017`, a name the host cannot resolve; without it the driver would try to reconnect to that name and fail. Transactions and change streams still work on a single-node replica set with a direct connection.

## 4. Backend Dockerfile requirements (multi-stage)
Build context is the **repo root** (`build: { context: ., dockerfile: backend/Dockerfile }`), because npm workspaces keep a single
`package-lock.json` at the root. A backend-only context has no lockfile, so `npm ci` would fail.
```
Stage base   : node:24-alpine, WORKDIR /app
Stage deps   : copy root package.json + package-lock.json + .npmrc + backend/package.json
               (+ frontend/package.json so the lockfile's workspace list resolves), npm ci -w backend --include-workspace-root=false
Stage dev    : from deps, copy backend source, CMD npm run dev -w backend
Stage build  : from deps, copy backend source, npm run build -w backend (tsc -> dist), npm prune --omit=dev
Stage runtime: node:24-alpine, NODE_ENV=production, copy dist + node_modules + package.json from build,
               run as non-root user `node`, EXPOSE 4000,
               HEALTHCHECK on /health/live,
               CMD ["node", "dist/server.js"]   # worker overrides command
```
- `.dockerignore`: node_modules, dist, coverage, .env*, tests, .git.
- Use `tini` (or `--init`) as PID 1 so `SIGTERM` reaches Node for graceful shutdown.
- Image labels: `org.opencontainers.image.source`, `version`, `revision` (git SHA via build arg).

## 5. Frontend Dockerfile requirements
Multi-stage with Next.js `output: "standalone"`, built from the repo root context like the backend: deps (`npm ci -w frontend`) → build (`npm run build -w frontend`) → runtime on `node:24-alpine` copying `frontend/.next/standalone`, `frontend/.next/static`, `frontend/public`. Because `outputFileTracingRoot` is the repo root, the standalone server is at `frontend/server.js` inside the standalone folder. Non-root user; `CMD ["node", "frontend/server.js"]`; `EXPOSE 3000`.
`API_INTERNAL_URL` is passed at runtime, not baked at build time: the `/api/*` proxy lives in `proxy.ts` and reads the variable per request (05 §5). `next.config` `rewrites` cannot be used for this because they are fixed at build time. Avoid `NEXT_PUBLIC_*` for anything environment-specific except the base path.

## 6. Mongo init script (`infra/docker/mongo-init.js`)
1. `rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] })` if not initiated.
2. Create role `auditAppendOnly` with `insert`, `find` on `straight_salon.audit_logs`.
3. Create user `ss_app` with `readWrite` on `straight_salon` **except** handled audit restriction (implemented with a custom role granting readWrite actions on all other collections + `auditAppendOnly`).
4. Local dev may skip auth (`MONGO_AUTH=false`) for simplicity; the script must support both.

## 7. Root npm scripts (Docker-related)
| Script | Does |
|---|---|
| `npm run up` | `docker compose up -d --build` |
| `npm run down` | `docker compose down` |
| `npm run reset` | `docker compose down -v` (wipes data) |
| `npm run logs` | `docker compose logs -f backend worker` |
| `npm run seed` | `docker compose exec backend npm run db:seed` |
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
