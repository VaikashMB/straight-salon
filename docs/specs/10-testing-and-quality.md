# 10 — Testing, Coverage & SonarQube

## 1. Targets
- **Coverage ≥ 80%** for lines, branches, functions, statements — enforced separately for backend and frontend by the test runner (build fails below threshold) **and** by the SonarQube quality gate.
- Critical pure logic (`shared/time/slots.ts`, status transition graph, permission map, price/duration totals) targets **≥ 95%**.
- SonarQube quality gate must pass: 0 bugs and 0 vulnerabilities of severity Blocker/Critical, security hotspots reviewed, duplication on new code < 3%, maintainability rating A.

## 2. Test pyramid

| Level | Backend | Frontend | Runs in |
|---|---|---|---|
| Unit | Vitest: services (repositories mocked), pure utils, mappers, Zod schemas, middleware | Vitest + RTL: components, hooks, utils | Every commit (pre-push) & CI |
| Integration | Vitest + Supertest against `createApp()` with **mongodb-memory-server (replica set)**, one per run (`test/setup/globalSetup.ts`), a fresh database per test file (`test/helpers/db.ts`); in-memory EventBus for business flows. ioredis-mock for cache/lock unit tests (it ignores `EXPIRE NX/GT`); **real Redis** for the BullMQ adapter and Redis 7 semantics (`test/integration/redis.int.test.ts`, `REDIS_TEST_URL`, default `redis://127.0.0.1:6379/15`; locally `docker compose up -d redis`, CI redis service) | Vitest + MSW: pages/features against mocked API | CI |
| Contract | OpenAPI drift check; response bodies validated against Zod response schemas in integration tests | Generated client type-checks against committed `openapi.json` | CI |
| E2E | — | Playwright against full docker-compose stack with seed data | CI (main branch & PRs labelled `e2e`), locally on demand |

## 3. Backend testing setup `[Node]`
```
backend/
├── vitest.config.ts          # projects: unit, integration
├── test/
│   ├── setup/
│   │   ├── globalSetup.ts    # start MongoMemoryReplSet, set env; returns teardown
│   │   └── testApp.ts        # builds app with test deps (fake clock, in-memory bus, mock providers)
│   ├── factories/            # buildUser(), buildService(), buildBooking() ... (fishery or hand-written)
│   ├── helpers/auth.ts       # createUser(), loginAs(role) -> bearer token; CSRF header constant
│   │                         # (test/setup/testApp.ts: buildApiTestApp() = full API, ioredis-mock with a
│   │                         #  unique host per app (instances on one host share data), bcrypt cost 4)
│   ├── helpers/logger.ts     # captureLogger(): real pino logger writing JSON lines to memory
│   └── integration/          # *.int.test.ts per module
└── src/**/__tests__/*.test.ts  # unit tests next to code
```
Vitest config essentials (`coverage` block, provider `v8`):
```ts
thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
reporter: ['text', 'text-summary', ['lcov', { projectRoot: '..' }], 'cobertura'],
include: ['src/**/*.ts'],
exclude: ['src/**/*.d.ts', 'src/**/__tests__/**', 'src/server.ts', 'src/worker.ts', 'src/relay.ts', 'src/db/seed/**', 'src/db/migrations/**'],
```
Reporters: Vitest's built-in `junit` reporter for CI test reports, on when `CI` is set (`reports/junit.xml` in each workspace, Phase 11). Sonar reads coverage from `lcov.info`; no separate Sonar test-execution reporter is needed. The lcov reporter writes paths relative to the repo root (`projectRoot: '..'`, so `backend/src/...`), which is where the scanner resolves them; workspace-relative `src/...` paths would match no file and report 0% coverage. Both workspaces use the same settings.

> Why Vitest instead of Jest (decided in Phase 0): the backend is ESM (03 §1), and several dependencies are ESM-only. Jest's ESM support is still experimental and needs transform workarounds. Vitest runs TypeScript and ESM natively and is already the frontend runner, so the repo uses one test runner throughout.

**mongodb-memory-server:** its postinstall download is denied in `allowScripts` (12 §1), so `npm install` (and Docker builds) never fetch a ~120 MB `mongod`. The binary downloads once on first test use into `~/.cache/mongodb-binaries`. Integration tests start a single-node replica set (`MongoMemoryReplSet`), matching Docker.

**Clock injection:** a `Clock` interface (`now()`) is injected everywhere time matters, so tests can freeze time. Never call `new Date()` directly in business logic.

**Minimum test list per module** (in addition to rules elsewhere):
- Every endpoint: happy path, validation failure, unauthenticated, forbidden role, not-found.
- Every BR-xxx: at least one passing and one failing test named with the ID.
- Booking concurrency: fire 10 parallel `POST /bookings` for the same stylist/slot → exactly 1 success (201), 9 × 409. Run it **twice**: with the Redis lock, and with the lock stubbed to always succeed, to prove the staff-day guard alone enforces BR-004 (02 §2.18).
- Availability edge cases: start/end of day, break boundaries, back-to-back bookings, buffer, lead time, holiday, time-off spanning days, stylist not qualified, "any" assignment fairness (FR-033).

## 4. Frontend testing setup `[Next]`
- Vitest with `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, MSW handlers generated per API area. Tests live in `frontend/tests/unit/` (mirroring `src/` paths); config in `frontend/vitest.config.mts` (Vite's native `resolve.tsconfigPaths` for the `@/` alias).
- Coverage via `@vitest/coverage-v8`, thresholds 80% all metrics; exclude `src/lib/api/schema.d.ts`, `src/components/ui/**` (generated shadcn), `*.config.*`, `app/**/layout.tsx` with no logic.
- Playwright: projects for Chromium and mobile viewport (Pixel 7). Scenarios listed in 05-frontend §9. Uses `data-testid` only where role/label queries are not possible.
- Playwright details (decision 2026-10-08): `frontend/playwright.config.ts`, specs in `frontend/tests/e2e/`, run with `npm run test:e2e` against a running stack (`E2E_BASE_URL`, default `http://localhost:3000`).
  - One worker, and the Pixel 7 project runs only the customer flow (the one that must work one-handed, 05 §2). The suite signs in about seven times per run, and the API allows 10 sign-ins per 15 minutes per IP (06 §4).
  - The global setup waits for the stack, then deletes the auth and booking rate-limit counters (`ss:v1:rl:auth:*`, `ss:v1:rl:bookings:*`) in the compose Redis, so reruns within 15 minutes work. `E2E_RESET_RATE_LIMITS=false` turns this off for other stacks.
  - Test data is prepared through the API (walk-in customers, phone bookings, status changes) with unique names and phones, so runs never collide and the stack can be reused. Only the step under test goes through the UI.
  - Scenarios use days after today, so they do not depend on the time of day. "My day" shows the browser's today, so the staff scenario sets the browser clock (`page.clock.setFixedTime`) to its booking's start; the API keeps real time (only `NO_SHOW` checks the clock, API-056).
  - Traces, screenshots and videos are kept for failures; CI also writes `reports/e2e-junit.xml`.

## 5. SonarQube

### 5.1 Local SonarQube
`docker-compose.sonar.yml` runs SonarQube Community Build (or the LTA release) + its Postgres on `http://localhost:9000` (see 11-docker). First login admin/admin → change password → create project `straight-salon` → generate token → put in `.env` as `SONAR_TOKEN` (never committed).
`npm run sonar:setup` does those steps idempotently (decision 2026-10-08): it changes the default admin password to `SONAR_ADMIN_PASSWORD` (generated into `.env` by `npm run env:init`), creates the project, creates or updates the quality gate of §5.4 and assigns it, and, when `SONAR_TOKEN` is empty, writes a project analysis token into `.env` without printing it.

### 5.2 `sonar-project.properties` (repo root)
```properties
sonar.projectKey=straight-salon
sonar.projectName=Straight Salon
sonar.sourceEncoding=UTF-8

sonar.sources=backend/src,frontend/src
sonar.tests=backend/src,backend/test,frontend/tests
sonar.test.inclusions=**/*.test.ts,**/*.test.tsx,**/*.int.test.ts,**/*.spec.ts
# Test files must be excluded from sources, or files under backend/src are indexed twice and the scan fails
sonar.exclusions=**/node_modules/**,**/dist/**,**/.next/**,**/coverage/**,**/__tests__/**,**/*.test.ts,**/*.test.tsx,frontend/src/lib/api/schema.d.ts,frontend/src/components/ui/**
# Same as the Vitest coverage excludes of each workspace
sonar.coverage.exclusions=backend/src/server.ts,backend/src/worker.ts,backend/src/relay.ts,backend/src/docs/export.ts,backend/src/db/runMigrations.ts,backend/src/db/runStatsRebuild.ts,backend/src/workers/runRetryFailed.ts,backend/src/db/seed/**,backend/src/db/migrations/**,frontend/src/app/**/layout.tsx,frontend/src/app/fonts.ts,**/*.config.*

sonar.javascript.lcov.reportPaths=backend/coverage/lcov.info,frontend/coverage/lcov.info
sonar.typescript.tsconfigPaths=backend/tsconfig.json,frontend/tsconfig.json
```
### 5.3 Running
- Local: `npm run test:coverage && npm run sonar` (root script uses the `sonarsource/sonar-scanner-cli` Docker image with `--network host` and `SONAR_HOST_URL`, `SONAR_TOKEN`). It runs as the developer's user, keeps its plugin cache in `.sonar-cache/` and its work files in `.scannerwork/` (both git- and docker-ignored), and waits for the quality gate, so a red gate fails the command.
- CI: SonarQube scan step after tests (self-hosted SonarQube or SonarCloud), followed by quality-gate check (`sonar.qualitygate.wait=true`) — failing gate fails the pipeline.
- CI uses **SonarCloud** (decision 2026-10-08): GitHub-hosted runners cannot reach a SonarQube on a developer's machine, and SonarCloud is free for public repositories and serves the README badges. Configuration: secret `SONAR_TOKEN`, repository variable `SONAR_ORGANIZATION` (default: the repository owner), optional `SONAR_PROJECT_KEY` (default `VaikashMB_straight-salon`, SonarCloud's key for an imported repo) and `SONAR_HOST_URL` (default `https://sonarcloud.io`; set it to use a self-hosted server instead). Turn off SonarCloud's automatic analysis, which would otherwise run without coverage. While `SONAR_TOKEN` is not set, the job skips with a notice instead of failing every run. SonarCloud's free plan applies its built-in "Sonar way" gate; "Straight Salon Way" (§5.4) is enforced on the local server.

### 5.4 Quality gate "Straight Salon Way"
Based on "Sonar way" plus: coverage on new code ≥ 80%, overall coverage ≥ 80%, duplicated lines on new code ≤ 3%, reliability/security/maintainability rating on new code = A, security hotspots reviewed = 100%.
Plus the overall targets of §1 (decision 2026-10-08): overall reliability and security rating C or better (no Blocker or High (Critical) issues) and overall maintainability rating A. Recent SonarQube versions run in Multi-Quality Rule mode, so the gate uses the `software_quality_*` rating metrics; `sonar:setup` falls back to the classic metrics on servers without them. Sonar way's own "no new issues" condition is kept.
"Major and above" in the Phase 11 brief means, in that mode's severity scale, **Blocker, High and Medium**; they are all fixed. Low and Info issues are left for later cleanup.

## 6. Static checks (run before tests)
- `tsc --noEmit` in both apps.
- ESLint 9 flat config with typescript-eslint `recommendedTypeChecked`, no import cycles (`eslint-plugin-import-x` in the backend; the `import` plugin bundled with `eslint-config-next` in the frontend), `eslint-plugin-security` (backend; `detect-object-injection` off: it flags every `obj[key]`, all hits were false positives, and injection is handled by strict Zod + `sanitizeFilter`), `eslint-plugin-jsx-a11y` recommended (frontend). Rules: no `console`, no floating promises, no explicit `any`. `--max-warnings=0`.
- Prettier check.
- `npm audit --audit-level=high`, gitleaks secret scan.
- Exceptions are explicit and reviewed (decision 2026-10-08). `npm run audit` (`scripts/audit.mjs`) fails on any high or critical advisory except those in `scripts/audit-allowlist.json`. Each entry gives the GHSA id, a reason and an `until` date, after which it fails again. It exists for advisories with no patched release, such as `braces` GHSA-vfj7-8cjw-p6xm, which is dev-only and reached through ESLint. Fixable ones are fixed instead: for example, `shell-quote` is pinned to `^1.12.0` with a root `overrides` entry. Reviewed gitleaks findings, the fixed JWT secrets used only by tests, are listed by fingerprint in `.gitleaksignore`.
