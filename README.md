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

Build status: **Phase 9** (public site: home, services with category tabs and search, service and stylist pages with reviews; the booking wizard; the customer account: upcoming and past bookings, cancel, reschedule, reviews, profile) is complete, on top of the Phase 8 frontend foundation; the backend API has been feature-complete since Phase 7. See `docs/specs/13-build-plan.md` for what comes next.

### Prerequisites

- Node.js **24** and npm ≥ 10. With [nvm](https://github.com/nvm-sh/nvm): `nvm install` (reads `.nvmrc`). Installs fail fast on other Node versions (`engine-strict`).
- Git.
- Docker Engine + Compose plugin (v2.24+), with your user in the `docker` group.

### Install and run

```bash
npm install                 # installs both workspaces and sets up the git hooks
npm run env:init            # creates .env (git-ignored) from .env.example with generated secrets
```

**Option A: everything in Docker** (hot reload via `docker-compose.override.yml`):

```bash
npm run up                  # docker compose up -d --build (applies migrations on start)
npm run seed                # settings, catalogue, staff, schedules, holidays, time-off and accounts (dev only):
                            #   admin@ / reception@ / ravi@ / priya@ / arjun@ / meera@ / customer1..10@straightsalon.local
                            #   all with password Password@123; ~60 bookings over the past 14 / next 7 days,
                            #   a few reviews, and the ratings and report figures computed from them
docker compose ps           # all services healthy; mongo-init "exited (0)"
npm run logs                # follow backend + worker logs
npm run down                # stop (npm run reset also wipes the data volumes)
```

**Option B: infra in Docker, apps on the host:**

```bash
docker compose up -d mongo mongo-init redis mailpit
npm run dev                 # backend :4000, worker, frontend :3000
```

Try the API in Swagger UI (http://localhost:4000/api/docs): `POST /api/v1/auth/login` with the seeded admin and the header `X-Requested-With: straight-salon-web`, then **Authorize** with the returned `accessToken`.

Check it:

- `curl http://localhost:4000/health/live` → `{"status":"ok"}`
- `curl http://localhost:4000/health/ready` → `{"status":"ok","checks":{"mongo":{"status":"up"},"redis":{"status":"up"}}}`
- App: http://localhost:3000 (sign in with a seeded account; each role lands in its area: customers `/account`, stylists `/staff`, reception and admin `/admin`) · Mailpit: http://localhost:8025 (emails from the Docker stack land here, including password-reset links)
- Bull Board: http://localhost:4000/admin/queues (browser login with an ADMIN email and password, e.g. the seeded `admin@straightsalon.local` / `Password@123`) · retry dead-lettered jobs: `npm run queues:retry-failed -- --queue=notifications`
- Reports: `GET /api/v1/reports/summary?from=…&to=…` (ADMIN) reads `daily_stats`, which the worker keeps current; rebuild it from bookings with `npm run stats:rebuild` (optionally `-- --from=YYYY-MM-DD --to=YYYY-MM-DD`)
- Optional tools: `npm run tools` → Mongo Express http://localhost:8081, Redis Insight http://localhost:5540
- Swagger UI (dev mode): http://localhost:4000/api/docs · raw spec: http://localhost:4000/api/docs/openapi.json · metrics: http://localhost:4000/metrics
- Production-style images only: `docker compose -f docker-compose.yml up -d --build`
- Mongo with authentication (enforces the append-only audit role): see `docker-compose.auth.yml`

### Checks

```bash
npm run lint            # ESLint, both workspaces
npm run typecheck       # tsc --noEmit, both workspaces
npm run test:coverage   # Vitest with 80% thresholds, both workspaces
npm run format:check    # Prettier
npm run validate        # everything CI will run (lint, format, typecheck, coverage, contract:check)
npm run openapi:export  # regenerate backend/openapi.json after API changes, then commit it
```

Backend integration tests start an in-memory MongoDB replica set automatically, and need a real Redis for the BullMQ tests: run `docker compose up -d redis` first (or set `REDIS_TEST_URL`).

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
| 2026-10-07 | Phase 9: public catalogue pages render per request from API reads cached 5 min (`next.revalidate: 300`) instead of build-time ISR (no backend during `next build`); booking-wizard URL parameters and step fallbacks; one Idempotency-Key per distinct request body; disabled Cancel/Reschedule use `aria-disabled` so the cut-off tooltip is keyboard-reachable; STAFF `staffId` read from the access-token claim.                                                                                                                                                                                                                                                                                                                                                               | 05, README                                                 |
| 2026-10-07 | Phase 8: `openapi-typescript` runs pinned via `npx` (its TypeScript 5 peer conflicts with the repo's TypeScript 6); `contract:check` also regenerates and diffs the frontend client; `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` (default 91) for phone normalisation, `NEXT_PUBLIC_API_BASE_PATH` retired; host-mode `next dev` reads only the frontend's variables from the root `.env`; area welcome pages and "soon" nav items until Phases 9/10; `msw` install script denied; `.dockerignore`/`.gitignore` no longer drop `backend/src/modules/reports`.                                                                                                                                                                                                                              | 05, 12, README                                             |
| 2026-10-07 | Phase 7: `daily_stats` field definitions (revenue = paid completed bookings; per-service revenue split by price snapshot so it sums to the total; booked minutes exclude cancelled and no-show time; no-show rate excludes cancellations); `canReview` on the Booking DTO; ADMIN `includeHidden=true` on `GET /reviews`; second review 409 `DUPLICATE`; review window counted from completion; CSV layout and formula-injection guard; dashboard and summary response shapes; audit log `from`/`to` as salon-local dates; derived read models (ratings, `daily_stats`) not audited; seed recomputes ratings and stats; extra `reviews` indexes; `stats:rebuild` script.                                                                                                           | 02, 04, 07, 09, 12, README                                 |
| 2026-10-07 | Phase 6: `ratings`/`stats` consumers and `stats-reconcile` moved to Phase 7 (they need `reviews`/`daily_stats`); channel rules (account messages email-only and always sent; booking messages per `emailOptIn`/`smsOptIn`; deactivated users get nothing); reschedule clears the reminder flags; Bull Board uses HTTP Basic with an ADMIN's email and password; reset links are redacted in stored notifications; `queue_jobs` metric; `APP_BASE_URL` required; Docker stack sends email to Mailpit.                                                                                                                                                                                                                                                                              | 02, 03, 04, 06, 09, 11, 12, 13, README                     |
| 2026-10-07 | Phase 5: STAFF see the customer's first name and a masked phone; one payment per booking (409 `PAYMENT_ALREADY_RECORDED`, 422 `PAYMENT_NOT_ALLOWED`); reception bookings default to source `PHONE`; manual `NO_SHOW` only after the start time; idempotency reserves the key while a request runs (409), stores only 2xx; payments module records through the bookings service; availability cache tags `avail` / `avail:{staffId}`; `/availability/days` returns `availableDates`; `/bookings/me` scope definitions; the no-op `ActiveBookingsGate` replaced by the bookings service.                                                                                                                                                                                            | 03, 04, 08, README                                         |
| 2026-10-06 | Phase 4: active-booking checks (API-018/020/032/036) go through an `ActiveBookingsGate` port, no-op until Phase 5; uploads served by the API at `/uploads` from a local ObjectStorage directory (`UPLOADS_DIR`, `UPLOADS_PUBLIC_URL`, `uploads_data` volume); ADMIN-only `includeInactive=true` on categories and staff; public settings include the booking policy; holidays and time-off are hard-deleted (audited); `INVALID_DURATION` code for BR-013; services get a partial unique index on active names; STAFF access tokens carry `staffId`; unpaginated lists are bare arrays.                                                                                                                                                                                           | 02, 03, 04, 08, 11, README                                 |
| 2026-10-06 | Phase 3: admins set a temporary password for new staff accounts; change-password keeps the current device signed in; own Redis rate limiter (fail-open global / fail-closed auth); CSRF header on every `POST /auth/*`; `INVALID_RESET_TOKEN`; wrong current password → 400 not 401; `walkin:create` permission; walk-in endpoint returns any existing customer by phone; admins can't change their own role/status; deactivation and role changes apply at next refresh; password max 72 bytes; `COOKIE_DOMAIN` empty by default; migrations as type-checked plain `.js` (changelog consistency); seed runs migrations and writes the admin.                                                                                                                                     | 02, 03, 04, 06, 07, 08, 10, 12, README                     |
| 2026-10-06 | Phase 2: access log as own middleware instead of `pino-http` (route pattern, exact 07 §1.3 fields); BullMQ job ID = `eventId` (BullMQ forbids `:`); outbox stores the full envelope, `secret` encrypted outside `payload`; static consumer routing table; `mongoose.trusted()` rule under `sanitizeFilter`; `PAYLOAD_TOO_LARGE` code; `env:init`; `contract:check` compares against the git index; `security/detect-object-injection` off; real Redis for BullMQ integration tests; `migrate-mongo` moved to Phase 3.                                                                                                                                                                                                                                                             | 02, 03, 04, 06, 07, 09, 10, 11, 12, 13, README             |
| 2026-10-06 | Phase 1: `/health/ready` treats Mongo as critical (503) and Redis as non-critical (200 `degraded`), reconciling 03 §6 with 08 §1; ioredis pinned to 5 for `ioredis-mock`; Docker builds from the repo root with `--ignore-scripts` and a separate prod-deps stage; numeric non-root UID; pinned image tags; `mongo:8.2` instead of 8.0 (8.0/8.3/9.0 refuse to start on Ubuntu 26.04 kernels until 8.0.35/9.0.3 images exist, 11 §1); separate worker image tag; host ports on 127.0.0.1; frontend gets no `.env`; Mongo auth overlay with verified append-only audit role; `shared/lifecycle` for entrypoints; worker skeleton.                                                                                                                                                   | 01, 03, 08, 10, 11, 12, 13, README                         |
| 2026-10-06 | Library updates: Node 24 LTS, Vitest for the backend (ESM), TypeScript 6.0 and ESLint 9 (newest majors supported by the lint toolchain), `jose`, `date-fns` v4 + `@date-fns/tz`, BullMQ Job Schedulers, `mongo:8.0`, `eslint-plugin-import-x`; dropped `hpp` (incompatible with Express 5) and `jest-sonar-reporter` (unmaintained).                                                                                                                                                                                                                                                                                                                                                                                                                                              | 03, 05, 10, 11, 12, README                                 |
