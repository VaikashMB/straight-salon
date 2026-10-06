# 13 — Phased Build Plan (for AI-assisted development)

Build strictly in order. Each phase ends with the Definition of Done in `AGENTS.md`. Commit at the end of every phase (tag it, e.g. `phase-3`). Copy the prompt for each phase into your AI tool.

---

## Phase 0 — Repository skeleton & tooling
**Scope:** `git init`; monorepo with npm workspaces, backend and frontend apps that boot, TypeScript strict, ESLint, Prettier, Husky, lint-staged, commitlint, `.editorconfig`, `.nvmrc`, `.env.example`, `.gitignore`, root scripts (12 §2, stubs allowed for later ones), `.github` templates (12 §1), empty `infra/k8s/.gitkeep`. The backend also gets a **minimal** `config/env.ts` (`NODE_ENV`, `PORT`, `APP_VERSION`, `LOG_LEVEL`, `LOG_PRETTY`) and a **minimal** Pino logger, so AGENTS.md's "config only from validated env, never `console.log`" holds from day one. Phase 2 extends both.
**Done when:** `npm run lint`, `npm run typecheck` and `npm run test:coverage` (≥ 80% in both workspaces) pass; backend `GET /health/live` returns ok; frontend shows placeholder home page; commitlint rejects a non-conventional message. DoD items for Swagger UI and `docker compose` are N/A in this phase.
> Prompt: *"Read AGENTS.md and docs/specs. Implement Phase 0 from 13-build-plan.md only: repo skeleton and tooling per 01-architecture §2 and 12-automation §1–2. Don't build features yet."*

## Phase 1 — Docker & infrastructure
**Scope:** backend & frontend multi-stage Dockerfiles, `docker-compose.yml` + override + `docker-compose.sonar.yml` (+ optional `docker-compose.auth.yml`), mongo replica set init with append-only audit role, redis, mailpit, tools profile (11-docker). Backend: `MONGO_URI`/`REDIS_URL` in `env.ts`, Mongo connection (`db/connect.ts`), Redis client (`shared/cache/redis.ts`), `/health/ready` with critical/non-critical dependencies (03 §6), `createApp(deps)`, shared process lifecycle (`shared/lifecycle`), worker entrypoint skeleton, Docker root scripts (11 §7).
**Done when:** `docker compose up --build` starts everything healthy; backend connects to Mongo (replica set) and Redis; `/health/ready` reports both up.
> Prompt: *"Implement Phase 1: Docker and local infra exactly as 11-docker-local-dev.md describes."*

## Phase 2 — Backend core (cross-cutting foundation)
**Scope:** extend `config/env.ts` (all 03 §3 variables needed so far); extend the Pino logger with redaction, access-log middleware & request context (07 §1); extend `createApp(deps)` with the new infra clients; error classes + problem+json middleware (03 §4); validation middleware; OpenAPI registry + Swagger UI (04 §2); Redis cache module with cache-aside, tags, lock (08); audit service (07 §2); `withTransaction`; `Clock`; EventBus interface + outbox writer + in-memory bus for tests + BullMQ adapter + relay (09 §4–6); staff-day guard support in `withTransaction` (02 §2.18); graceful shutdown; `/metrics`; Vitest global setup with memory replica set; test factories; `openapi:export` + `contract:check`; `env:init`. (`migrate-mongo` moves to Phase 3 with the first business collections.)
**Done when:** unit tests for all shared modules ≥ 90% coverage; Swagger UI loads with health endpoints documented.
> Prompt: *"Implement Phase 2: all cross-cutting backend foundations (03, 07, 08, 09 §4–6, 10 §3). No business modules yet. Include tests."*

## Phase 3 — Auth & users
**Scope:** `migrate-mongo` setup (`db:migrate`, `MIGRATE_ON_START`, index migrations for existing and new collections, 02 §1); users model, refresh tokens, password reset tokens; API-001…015; RBAC permission map & middleware; rate limits & login lockout; security tests (06 §5); audit entries for auth events; seed admin user.
> Prompt: *"Implement Phase 3: auth and users modules per 06-auth-and-security, API-001 to API-015, with all required tests."*

## Phase 4 — Settings, catalog, staff, schedules, holidays
**Scope:** API-016…037 (including API-027 image upload + `ObjectStorage` local adapter); caching of public reads; events `catalog.changed`, `staff.*`, `settings.changed`, `holiday.changed`; seed script for everything that exists so far (02 §3: settings, users, catalogue, staff, schedules, holidays, time-off). Bookings are seeded in Phase 5 and reviews in Phase 7.
> Prompt: *"Implement Phase 4: settings, holidays, catalog, uploads, staff, schedules and time-off (API-016 to API-037), caching per 08, events per 09, and the seed script for these collections."*

## Phase 5 — Availability & bookings (core)
**Scope:** slot engine pure functions (03 §5.2) with exhaustive tests; API-040, 041; booking creation algorithm with lock + staff-day guard + transaction + audit + outbox (03 §5.1); API-050…058 (including walk-in `checkInNow`); BR-001…015; idempotency keys; concurrency test (10 bookings → 1 success, with and without the lock); seed bookings and payments.
> Prompt: *"Implement Phase 5: availability and bookings. Start with the slot engine as pure functions and their tests, then endpoints API-040 to API-058 enforcing BR-001 to BR-015."*

## Phase 6 — Workers, notifications & scheduled jobs
**Scope:** worker entrypoint; consumers (notifications, staff-notifications, cache-invalidation, ratings, stats); idempotent wrapper; templates; mock + SMTP providers (Mailpit); scheduled jobs (09 §7); Bull Board; API-065, 066.
**Done when:** booking in Swagger → email visible in Mailpit within seconds; reminders and auto no-show verified with fake clock tests.
> Prompt: *"Implement Phase 6: worker process, all consumers and scheduled jobs from 09-events-and-messaging, with idempotency and tests."*

## Phase 7 — Reviews, reports, audit API
**Scope:** API-060…062, API-070…073, `daily_stats` read model, CSV export, `stats:rebuild` script, seed reviews.
> Prompt: *"Implement Phase 7: reviews, reports (with daily_stats), CSV export and audit log API (API-060 to API-073)."*

## Phase 8 — Frontend foundation
**Scope:** Tailwind + shadcn setup, theme (05 §2), layouts per area, generated typed API client, AuthProvider with refresh single-flight, middleware route protection, error-code mapping, formatting utils, Vitest + MSW setup; login/register/forgot/reset pages.
> Prompt: *"Implement Phase 8: frontend foundation and auth pages per 05-frontend §1–3, §5–7."*

## Phase 9 — Public site & booking wizard
**Scope:** home, services, service detail, stylists, stylist profile (ISR); full booking wizard (05 §4.1); customer account pages (05 §4.2).
> Prompt: *"Implement Phase 9: public pages and the booking wizard plus customer account area per 05-frontend §4.1–4.2, with component tests."*

## Phase 10 — Staff & admin areas
**Scope:** staff day/week/time-off; admin dashboard, calendar, bookings table with walk-in and payment dialogs, CRUD pages, schedule editor, reports with charts and CSV, audit viewer, notifications viewer, settings.
> Prompt: *"Implement Phase 10: staff area and admin area per 05-frontend §4.3–4.4."*

## Phase 11 — Quality hardening & CI
**Scope:** fill coverage gaps to ≥ 80% everywhere; Playwright e2e suite; SonarQube local run with quality gate passing; GitHub Actions CI (12 §3); README badges; contract drift check.
> Prompt: *"Implement Phase 11: e2e tests, SonarQube configuration, and the CI pipeline per 10 and 12. Fix all Sonar issues of severity major and above."*

## Phase 12 — Release v1.0
Final pass: update README (setup, URLs, demo credentials, architecture diagram), tag `v1.0.0`.

---

## After v1 — Forward Deployed Engineering track (future specs)
These will get their own spec files later (`14-…` onwards). Listed here so v1 decisions stay compatible:
1. **Container registry & image hygiene** — GHCR, tagging strategy, SBOM, signing.
2. **Kubernetes basics** — Deployments (api, worker, frontend), Services, Ingress + TLS, ConfigMaps/Secrets, probes mapped to `/health/*`, resource requests/limits, HPA on api.
3. **Stateful dependencies** — managed MongoDB Atlas & managed Redis vs. StatefulSets; backups and restore drills.
4. **Helm or Kustomize** — environment overlays (dev/staging/prod).
5. **CD & GitOps** — GitHub Actions → Argo CD; rolling, blue-green, canary releases; migrations as Jobs.
6. **Observability stack** — OpenTelemetry tracing, Prometheus + Grafana dashboards, Loki for logs, alerts (SLOs on booking latency & error rate).
7. **Secrets management** — External Secrets / Vault / cloud secret managers.
8. **Messaging at scale** — swap EventBus adapter to RabbitMQ or Kafka.
9. **Security in the pipeline** — SAST, DAST (OWASP ZAP), image scanning, policy (OPA/Kyverno).
10. **Customer-facing deployment work** — environment-specific config, multi-tenant (multi-salon) design, onboarding a second salon as a "client" — the core FDE skill.
