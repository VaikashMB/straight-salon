# Straight Salon — Specification Pack

Straight Salon is a salon appointment booking and management platform. Customers browse services, pick a stylist and time slot, and manage their bookings. Staff see their schedules. Admins (the salon owner/manager) manage services, staff, working hours, walk-ins, and view business analytics.

This repository starts with **specifications only**. The application is meant to be built by AI coding tools (Claude Code, Cursor, Copilot, etc.) by following these specs phase by phase.

## Reference stack (v1)

| Layer                | Choice                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| Frontend             | Next.js 16 (App Router) + TypeScript + Tailwind CSS                                                          |
| Backend              | Node.js (24 LTS) + Express 5 + TypeScript (ESM)                                                              |
| Database             | MongoDB 7+ (Docker: `mongo:8.2`, see 11 §1; Mongoose ODM), single-node replica set for transactions          |
| Cache / Queue broker | Redis 7                                                                                                      |
| Messaging            | BullMQ on Redis (behind an `EventBus` abstraction so RabbitMQ/Kafka can be swapped in later)                 |
| Auth                 | JWT access token + rotating refresh token (httpOnly cookie)                                                  |
| API docs             | OpenAPI 3.1, generated from Zod schemas, served with Swagger UI                                              |
| Logging              | Pino (structured JSON) with request correlation IDs                                                          |
| Auditing             | Append-only `audit_logs` collection                                                                          |
| Testing              | Vitest + Supertest + mongodb-memory-server (backend), Vitest + React Testing Library + Playwright (frontend) |
| Quality gate         | SonarQube, minimum 80% coverage on new and overall code                                                      |
| Containers           | Docker + Docker Compose for local development                                                                |
| Automation           | ESLint, Prettier, Husky, lint-staged, commitlint, GitHub Actions CI, scheduled jobs                          |

The specs are written to be **stack-agnostic where possible**. Anything stack-specific is marked with a `[Node]`, `[Next]`, or `[Mongo]` tag so the same specs can be reused when you rebuild in another stack (e.g. Java/Spring, .NET, Go, Postgres).

## Spec index

| File                                    | Purpose                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `AGENTS.md`                             | Rules for the AI coding agent. Point your AI tool at this first.                   |
| `docs/specs/00-product-requirements.md` | What we're building and why: personas, features, user stories, acceptance criteria |
| `docs/specs/01-architecture.md`         | System design, repo layout, module boundaries, cross-cutting concerns              |
| `docs/specs/02-database.md`             | Collections, fields, indexes, constraints, seed data                               |
| `docs/specs/03-backend.md`              | Backend structure, layers, modules, business rules, config                         |
| `docs/specs/04-api-contract.md`         | Every endpoint: method, path, auth, request, response, errors; OpenAPI rules       |
| `docs/specs/05-frontend.md`             | Pages, routes, components, state, forms, UX rules                                  |
| `docs/specs/06-auth-and-security.md`    | JWT flow, roles and permissions, security controls                                 |
| `docs/specs/07-logging-and-auditing.md` | Log format, levels, correlation, audit trail                                       |
| `docs/specs/08-caching.md`              | What is cached, keys, TTLs, invalidation, rate limiting                            |
| `docs/specs/09-events-and-messaging.md` | Domain events, outbox pattern, workers, retries, idempotency                       |
| `docs/specs/10-testing-and-quality.md`  | Test strategy, coverage, SonarQube setup and quality gate                          |
| `docs/specs/11-docker-local-dev.md`     | Dockerfiles and docker-compose for local development                               |
| `docs/specs/12-automation-and-ci.md`    | Git hooks, scripts, CI pipeline, scheduled jobs                                    |
| `docs/specs/13-build-plan.md`           | Phased build order with ready-to-use prompts for the AI                            |

## Getting started (local development)

Build status: **Phase 1** (Docker & infrastructure) is complete. See `docs/specs/13-build-plan.md` for what comes next.

### Prerequisites

- Node.js **24** and npm ≥ 10. With [nvm](https://github.com/nvm-sh/nvm): `nvm install` (reads `.nvmrc`). Installs fail fast on other Node versions (`engine-strict`).
- Git.
- Docker Engine + Compose plugin (v2.24+), with your user in the `docker` group.

### Install and run

```bash
npm install                 # installs both workspaces and sets up the git hooks
cp .env.example .env        # local config (git-ignored); adjust as needed
```

**Option A: everything in Docker** (hot reload via `docker-compose.override.yml`):

```bash
npm run up                  # docker compose up -d --build
docker compose ps           # all services healthy; mongo-init "exited (0)"
npm run logs                # follow backend + worker logs
npm run down                # stop (npm run reset also wipes the data volumes)
```

**Option B: infra in Docker, apps on the host:**

```bash
docker compose up -d mongo mongo-init redis mailpit
npm run dev                 # backend :4000, worker, frontend :3000
```

Check it:

- `curl http://localhost:4000/health/live` → `{"status":"ok"}`
- `curl http://localhost:4000/health/ready` → `{"status":"ok","checks":{"mongo":{"status":"up"},"redis":{"status":"up"}}}`
- App: http://localhost:3000 · Mailpit: http://localhost:8025
- Optional tools: `npm run tools` → Mongo Express http://localhost:8081, Redis Insight http://localhost:5540
- Production-style images only: `docker compose -f docker-compose.yml up -d --build`
- Mongo with authentication (enforces the append-only audit role): see `docker-compose.auth.yml`

### Checks

```bash
npm run lint            # ESLint, both workspaces
npm run typecheck       # tsc --noEmit, both workspaces
npm run test:coverage   # Vitest with 80% thresholds, both workspaces
npm run format:check    # Prettier
npm run validate        # everything CI will run
```

Commits must follow Conventional Commits with a scope from `commitlint.config.mjs`, e.g. `feat(booking): add reschedule endpoint (API-054)`. The pre-commit hook lints and formats staged files; the pre-push hook runs unit tests for the workspaces you changed.

## How to use this pack with an AI coding tool

1. Create an empty Git repository and copy this whole folder into it.
2. Open the repo in your AI tool and tell it: _"Read AGENTS.md and all files in docs/specs. Then implement Phase 0 from 13-build-plan.md only."_
3. Review, run tests, commit. Then move to the next phase.
4. Never ask the AI to "build the whole app" in one go. Phase-by-phase is what keeps AI builds correct.

## Spec ID conventions

- `FR-xxx` functional requirement (00-product-requirements)
- `NFR-xxx` non-functional requirement
- `BR-xxx` business rule (03-backend)
- `EVT-xxx` domain event (09-events)
- `API-xxx` endpoint (04-api-contract)

Code comments, test names, and commit messages should reference these IDs, e.g. `test('BR-004 rejects overlapping bookings for same stylist', ...)`.

## Out of scope for v1 (planned for the deployment/FDE learning phase)

Kubernetes, Helm, cloud deployment, managed databases, horizontal scaling, observability stack (Prometheus/Grafana/Loki/OpenTelemetry collector), secrets managers, blue-green/canary releases. The v1 code is designed so these can be added without rewriting the application (12-factor config, health probes, stateless API, externalized state).

## Spec revision log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Specs touched                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 2026-10-06 | Phase 0 review: resolved ambiguities and contradictions. Key changes: staff-day guard document so BR-004 holds under concurrency without relying on Redis; `ss_session` indicator cookie for frontend route protection; runtime `/api/*` proxy in `proxy.ts` (Next 16) instead of build-time rewrites; root-context Docker builds for the workspace lockfile; `directConnection=true` for host-mode Mongo; lead-time filter applied after the availability cache; walk-in `checkInNow`; 422 `ACTIVE_BOOKINGS_EXIST` + `force` semantics for holidays/time-off; new error codes; extended permission map; image upload endpoint API-027; `booking.reminder_due` event (EVT-017); outbox `PUBLISHING`/`claimedAt`; incremental seed; Sonar test exclusions; explicit commit scopes. | AGENTS, 00, 01, 02, 03, 04, 05, 06, 08, 09, 10, 11, 12, 13 |
| 2026-10-06 | Phase 1: `/health/ready` treats Mongo as critical (503) and Redis as non-critical (200 `degraded`), reconciling 03 §6 with 08 §1; ioredis pinned to 5 for `ioredis-mock`; Docker builds from the repo root with `--ignore-scripts` and a separate prod-deps stage; numeric non-root UID; pinned image tags; `mongo:8.2` instead of 8.0 (8.0/8.3/9.0 refuse to start on Ubuntu 26.04 kernels until 8.0.35/9.0.3 images exist, 11 §1); separate worker image tag; host ports on 127.0.0.1; frontend gets no `.env`; Mongo auth overlay with verified append-only audit role; `shared/lifecycle` for entrypoints; worker skeleton.                                                                                                                                                   | 01, 03, 08, 10, 11, 12, 13, README                         |
| 2026-10-06 | Library updates: Node 24 LTS, Vitest for the backend (ESM), TypeScript 6.0 and ESLint 9 (newest majors supported by the lint toolchain), `jose`, `date-fns` v4 + `@date-fns/tz`, BullMQ Job Schedulers, `mongo:8.0`, `eslint-plugin-import-x`; dropped `hpp` (incompatible with Express 5) and `jest-sonar-reporter` (unmaintained).                                                                                                                                                                                                                                                                                                                                                                                                                                              | 03, 05, 10, 11, 12, README                                 |
