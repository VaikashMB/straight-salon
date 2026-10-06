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
reporter: ['text', 'text-summary', 'lcov', 'cobertura'],
include: ['src/**/*.ts'],
exclude: ['src/**/*.d.ts', 'src/**/__tests__/**', 'src/server.ts', 'src/worker.ts', 'src/relay.ts', 'src/db/seed/**', 'src/db/migrations/**'],
```
Reporters: Vitest's built-in `junit` reporter for CI test reports (added in Phase 11). Sonar reads coverage from `lcov.info`; no separate Sonar test-execution reporter is needed.

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

## 5. SonarQube

### 5.1 Local SonarQube
`docker-compose.sonar.yml` runs SonarQube Community Build (or the LTA release) + its Postgres on `http://localhost:9000` (see 11-docker). First login admin/admin → change password → create project `straight-salon` → generate token → put in `.env` as `SONAR_TOKEN` (never committed).

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
sonar.coverage.exclusions=backend/src/server.ts,backend/src/worker.ts,backend/src/relay.ts,backend/src/db/seed/**,backend/src/db/migrations/**,**/*.config.*

sonar.javascript.lcov.reportPaths=backend/coverage/lcov.info,frontend/coverage/lcov.info
sonar.typescript.tsconfigPaths=backend/tsconfig.json,frontend/tsconfig.json
```
### 5.3 Running
- Local: `npm run test:coverage && npm run sonar` (root script uses the `sonarsource/sonar-scanner-cli` Docker image with `--network host` and `SONAR_HOST_URL`, `SONAR_TOKEN`).
- CI: SonarQube scan step after tests (self-hosted SonarQube or SonarCloud), followed by quality-gate check (`sonar.qualitygate.wait=true`) — failing gate fails the pipeline.

### 5.4 Quality gate "Straight Salon Way"
Based on "Sonar way" plus: coverage on new code ≥ 80%, overall coverage ≥ 80%, duplicated lines on new code ≤ 3%, reliability/security/maintainability rating on new code = A, security hotspots reviewed = 100%.

## 6. Static checks (run before tests)
- `tsc --noEmit` in both apps.
- ESLint 9 flat config with typescript-eslint `recommendedTypeChecked`, no import cycles (`eslint-plugin-import-x` in the backend; the `import` plugin bundled with `eslint-config-next` in the frontend), `eslint-plugin-security` (backend; `detect-object-injection` off: it flags every `obj[key]`, all hits were false positives, and injection is handled by strict Zod + `sanitizeFilter`), `eslint-plugin-jsx-a11y` recommended (frontend). Rules: no `console`, no floating promises, no explicit `any`. `--max-warnings=0`.
- Prettier check.
- `npm audit --audit-level=high`, gitleaks secret scan.
