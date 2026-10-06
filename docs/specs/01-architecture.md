# 01 — Architecture

## 1. High-level view

```
                ┌───────────────────────┐
  Browser  ───► │  Next.js frontend     │  (SSR for public pages, client components for app)
                └──────────┬────────────┘
                           │ HTTPS / JSON  (/api/v1/*)
                ┌──────────▼────────────┐
                │  Node.js API (Express)│── Swagger UI at /api/docs
                │  - auth, validation   │
                │  - business modules   │──► Redis (cache, rate-limit, locks)
                │  - outbox writer      │
                └──────────┬────────────┘
                           │ Mongoose
                ┌──────────▼────────────┐
                │  MongoDB (replica set)│◄── outbox relay reads `outbox_events`
                └───────────────────────┘
                           │
                ┌──────────▼────────────┐        ┌──────────────────────┐
                │ Outbox relay process  │ ─────► │ BullMQ queues (Redis)│
                └───────────────────────┘        └──────────┬───────────┘
                                                            │
                                         ┌──────────────────▼─────────────┐
                                         │ Worker process                 │
                                         │ - notifications (email/SMS)    │
                                         │ - cache invalidation           │
                                         │ - stats aggregation            │
                                         │ - scheduled jobs (reminders,   │
                                         │   auto no-show)                │
                                         └────────────────────────────────┘
```

The backend codebase produces **three runnable processes from one image**, selected by command:
- `api` — HTTP server (`node dist/server.js`)
- `worker` — queue consumers and scheduled jobs (`node dist/worker.js`)
- `relay` — outbox relay (`node dist/relay.js`). In v1 the relay can run inside the worker process via a config flag (`RUN_RELAY_IN_WORKER=true`) to keep local setup simple.

This split is deliberate: later, in Kubernetes, each becomes its own Deployment that can be scaled independently.

## 2. Repository layout (monorepo)

```
straight-salon/
├── AGENTS.md
├── README.md
├── docs/specs/                 # these files
├── backend/
│   ├── src/
│   │   ├── config/             # env validation, constants
│   │   ├── shared/             # cross-cutting: logger, errors, http, cache, events, audit, auth utils
│   │   ├── modules/            # one folder per business module (see 03-backend)
│   │   ├── jobs/               # scheduled job definitions
│   │   ├── workers/            # queue consumers
│   │   ├── docs/               # OpenAPI registry & generator
│   │   ├── db/                 # connection, migrations, seeds
│   │   ├── app.ts              # express app factory (no listen) — testable
│   │   ├── server.ts           # api entrypoint
│   │   ├── worker.ts           # worker entrypoint
│   │   └── relay.ts            # outbox relay entrypoint
│   ├── test/                   # integration & e2e API tests, helpers, factories
│   ├── Dockerfile              # built with the repo root as context (single root lockfile, see 11 §4)
│   ├── vitest.config.ts        # projects: unit, integration
│   ├── eslint.config.mjs
│   ├── tsconfig.json           # typecheck (src + test); tsconfig.build.json emits dist/
│   └── package.json            # "type": "module" (ESM, NodeNext resolution)
├── frontend/
│   ├── src/app/                # Next.js App Router
│   ├── src/components/
│   ├── src/features/           # feature-scoped components, hooks, api calls
│   ├── src/lib/                # api client, auth, utils
│   ├── tests/unit/             # Vitest + RTL component/unit tests
│   ├── tests/e2e/              # Playwright
│   ├── Dockerfile
│   ├── vitest.config.mts
│   └── package.json
├── infra/
│   ├── docker/                 # mongo init (replica set), sonar config
│   └── k8s/                    # EMPTY in v1 — reserved for the deployment phase
├── scripts/                    # repo tooling (git-hook helpers, phase stubs)
├── .github/                    # workflows (CI), PR/issue templates, CODEOWNERS, dependabot
├── .husky/                     # git hooks (12 §1)
├── docker-compose.yml          # base stack (production-style images)
├── docker-compose.override.yml # dev overrides, auto-loaded: dev targets, hot reload, inspector
├── docker-compose.auth.yml     # optional overlay: Mongo with auth + keyfile (append-only audit enforced)
├── docker-compose.sonar.yml
├── .dockerignore               # build context is the repo root
├── sonar-project.properties
├── tsconfig.base.json          # shared strict compiler options
├── commitlint.config.mjs  .lintstagedrc.mjs  .prettierrc.json  .editorconfig
├── .nvmrc  .npmrc              # Node 24; engine-strict
├── .env.example
└── package.json                # npm workspaces root: ["backend", "frontend"]
```

## 3. Architectural principles
1. **Modular monolith.** Business modules (`auth`, `users`, `services`, `staff`, `schedule`, `availability`, `bookings`, `payments`, `reviews`, `notifications`, `reports`, `settings`, `audit`) live in one deployable but only talk to each other through their **service** public interfaces or **domain events** — never by reaching into another module's repository/model. This allows extracting a module into a microservice later.
2. **12-factor app.** Config from env, logs to stdout, stateless processes, backing services (Mongo, Redis) attached by URL.
3. **Contract first.** Zod schemas are the single source of truth for validation, TypeScript types, and OpenAPI docs.
4. **Reliable side effects.** Anything that leaves the transaction boundary (notifications, cache busting across instances, analytics) goes through the transactional outbox and queues, never fire-and-forget inside the request.
5. **Testability.** `createApp(deps)` factory with dependency injection of infra clients so tests can use in-memory Mongo and a fake Redis/queue.

## 4. Cross-cutting concerns map

| Concern | Where | Spec |
|---|---|---|
| Authentication (JWT) | `shared/auth`, `modules/auth` | 06 |
| Authorization (RBAC) | `shared/auth/authorize.ts` middleware | 06 |
| Validation | `shared/http/validate.ts` (Zod) | 03, 04 |
| Error handling | `shared/errors` + error middleware | 03, 04 |
| Logging | `shared/logger` (Pino) + `pino-http` | 07 |
| Correlation ID | `shared/http/requestContext.ts` (AsyncLocalStorage) | 07 |
| Auditing | `shared/audit` + `modules/audit` | 07 |
| Caching | `shared/cache` (Redis, cache-aside) | 08 |
| Rate limiting | `shared/http/rateLimit.ts` (Redis store) | 06, 08 |
| Events / messaging | `shared/events` (outbox, EventBus, BullMQ adapter) | 09 |
| API docs | `src/docs` (zod-to-openapi) | 04 |
| Health checks | `/health/live`, `/health/ready` | 03 |
| Config | `config/env.ts` (Zod-validated) | 03 |

## 5. Request lifecycle (API)
1. `requestContext` middleware: read `X-Request-Id` or generate UUID; store in AsyncLocalStorage; echo back in response header.
2. `pino-http` request logging.
3. `helmet`, `cors`, `compression`, JSON body limit (100 kb).
4. Rate limiter (global + stricter on auth routes).
5. Route match → `authenticate` (if protected) → `authorize(roles/permissions)` → `validate(schema)`.
6. Controller → Service (business rules, transaction, audit, outbox) → Repository → Model.
7. Response serialiser (strip internal fields, map `_id` → `id`).
8. Error middleware converts any thrown error into RFC 7807 problem JSON and logs it.

## 6. Future-ready decisions (for the deployment/FDE phase)
- Health probes already exist → Kubernetes liveness/readiness.
- Graceful shutdown on `SIGTERM` (stop accepting requests, drain, close Mongo/Redis/queues within 10 s) → zero-downtime rolling deploys.
- Separate api/worker/relay entrypoints → independent scaling.
- No local file storage; images go to an `ObjectStorage` interface (local disk adapter in dev, S3-compatible later).
- `EventBus` interface → swap BullMQ for RabbitMQ/Kafka without touching modules.
- Prometheus metrics endpoint `/metrics` (prom-client) exposed but not scraped in v1.
