# 03 — Backend (Node.js)

## 1. Tech choices `[Node]`
| Concern | Library |
|---|---|
| Runtime | Node.js 24 LTS, TypeScript 6.0 (strict), ES2022 target, **ESM** (`"type": "module"`, `module: nodenext`; relative imports use `.js` extensions) |
| HTTP | Express 5 |
| Validation & types | Zod 4 |
| OpenAPI | `@asteasolutions/zod-to-openapi` (Zod 4-compatible major) + `swagger-ui-express` |
| ODM | Mongoose (current major at the time of Phase 2; check the migration guide) |
| Redis client | `ioredis` 5 (not 6 yet: `ioredis-mock`, used in tests, supports only 5; BullMQ accepts either). App client uses `enableOfflineQueue: false` + `maxRetriesPerRequest: 1` so commands fail fast while Redis is down; BullMQ gets its own connections |
| Queue | BullMQ |
| Auth | `jose` (JWT; also covers the planned RS256 move), `bcrypt` (prebuilt binaries; `bcryptjs` is the drop-in fallback if the Alpine build fails) |
| Logging | `pino`, `pino-pretty` (dev only). HTTP access log is a ~30-line middleware (`shared/http/accessLog.ts`), not `pino-http`: the spec needs the route *pattern* and exactly the fields in 07 §1.3; `pino-http` logs raw URLs/headers by default and its `customProps` hook binds at request start *and* finish, duplicating fields |
| Security | `helmet`, `cors`, own Redis fixed-window rate limiter (`shared/http/rateLimit.ts`, atomic Lua INCR+PEXPIRE) instead of `express-rate-limit` + `rate-limit-redis`: 08 §5 needs fail-open for the global limit but fail-closed for auth limits, keys must come from `keys.ts`, and Lua runs under ioredis-mock so tests need no Docker. (`hpp` is not used: it reassigns `req.query`, which is a read-only getter in Express 5; Zod rejects arrays where strings are expected.) |
| Dates | `date-fns` v4 + `@date-fns/tz` (`TZDate`); all tz math centralised in `shared/time` |
| Scheduling | BullMQ **Job Schedulers** (`upsertJobScheduler`; replaces the deprecated repeatable-jobs API). No in-process cron, so it is safe with multiple instances |
| Metrics | `prom-client` |
| Testing | Vitest (projects `unit` + `integration`, v8 coverage), Supertest, mongodb-memory-server (replica set mode), ioredis-mock |
| Dev | tsx (watch), ESLint 9 (typescript-eslint, import-x, security), Prettier |

> Version notes (2026-10): ESLint stays on 9 because `eslint-config-next`'s plugins do not support ESLint 10 yet. TypeScript stays on 6.0 because typescript-eslint does not support TypeScript 7 yet. Revisit both when support lands.

## 2. Folder structure

```
backend/src/
├── config/
│   ├── env.ts                 # Zod schema for process.env; process exits on invalid config
│   └── constants.ts
├── shared/
│   ├── logger/                # pino instance, redaction, requestContext mixin
│   ├── metrics/               # prom-client registry, HTTP histogram, cache counters, gauges
│   ├── http/                  # requestContext, validate, asyncHandler, pagination, response mappers
│   │                          #   validate() stores parsed input on req.validated.{body,query,params};
│   │                          #   it never reassigns req.query (read-only getter in Express 5)
│   ├── errors/                # AppError, NotFoundError, ConflictError, ... + errorHandler middleware
│   ├── auth/                  # jwt utils, authenticate, authorize, permissions map
│   ├── audit/                 # auditService.record(), diff util
│   ├── cache/                 # redis.ts (client, ping, close), cacheAside(), key builders, invalidation
│   ├── events/                # envelope, registry (Zod payloads), outbox model/repository/writer, secret (AES-GCM),
│   │                          #   EventBus + in-memory + BullMQ adapters, subscriptions table, relay, idempotent()
│   ├── locks/                 # Redis distributed lock (SET NX PX + token)
│   ├── time/                  # tz helpers, slot math
│   ├── db/                    # withTransaction helper
│   ├── storage/               # ObjectStorage interface + local adapter
│   └── lifecycle/             # loadEnvOrExit, createProcessLogger, registerShutdown (shared by api/worker/relay)
├── modules/
│   ├── auth/
│   ├── users/
│   ├── settings/
│   ├── catalog/               # categories + services
│   ├── staff/                 # staff profiles, schedules, time-off
│   ├── holidays/
│   ├── availability/
│   ├── bookings/              # also bookings.gate.ts: the ActiveBookingsGate port settings/holidays/staff use for
│   │                          #   ACTIVE_BOOKINGS_EXIST / force, implemented by the bookings service
│   ├── payments/              # recording payments on bookings (through the bookings service, no own collection)
│   ├── reviews/
│   ├── notifications/         # templates, providers (email/sms/mock), sender
│   ├── reports/               # daily_stats read model + queries + CSV
│   ├── audit/                 # read API over audit_logs
│   └── health/
├── jobs/                      # BullMQ job scheduler definitions (reminders, no-show, stats)
├── workers/                   # BullMQ processors wiring
├── docs/                      # openapi registry & document builder
├── db/                        # connect.ts (connectMongo, pingMongo, disconnectMongo), migrations/, seed/
├── app.ts
├── server.ts
├── worker.ts
└── relay.ts
```

### Module internal layout (every module follows this)
```
modules/bookings/
├── bookings.routes.ts       # Express router + OpenAPI path registration
├── bookings.controller.ts   # HTTP <-> service mapping only
├── bookings.service.ts      # business rules, transactions, audit, outbox
├── bookings.repository.ts   # all Mongoose queries
├── bookings.model.ts        # Mongoose schema
├── bookings.schemas.ts      # Zod request/response schemas (+ .openapi() metadata)
├── bookings.events.ts       # event payload types this module emits
├── bookings.mapper.ts       # model -> DTO
└── __tests__/               # unit tests for service, mapper, schemas
```

## 3. Configuration (`.env`)
All validated at boot in `config/env.ts`. Example values in `.env.example`. `env.ts` starts in Phase 0 with `NODE_ENV`, `PORT`, `APP_VERSION`, `LOG_LEVEL` and `LOG_PRETTY`; Phase 1 adds `MONGO_URI` and `REDIS_URL` (both required, scheme-checked); each later phase adds the variables it uses. The worker and relay parse the same schema (they ignore `PORT`). In dev, `npm run dev` loads the repo-root `.env` (`--env-file-if-exists`). In containers, variables come from Compose.

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `development` | development / test / production |
| `PORT` | `4000` | required, no default (no hard-coded ports) |
| `APP_VERSION` | `1.0.0` | logged as `version` on every line (07 §1.1); set from the image build arg in Docker; defaults to `0.0.0-dev` |
| `APP_BASE_URL` | `http://localhost:3000` | used in emails |
| `CORS_ORIGINS` | `http://localhost:3000` | comma-separated |
| `MONGO_URI` | `mongodb://mongo:27017/straight_salon?replicaSet=rs0` | from the host add `&directConnection=true` and use `localhost` (see 11 §3) |
| `REDIS_URL` | `redis://redis:6379` | |
| `JWT_ACCESS_SECRET` | (32+ chars) | |
| `JWT_ACCESS_TTL` | `15m` | |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `straight-salon-api` / `straight-salon-web` | |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | |
| `COOKIE_DOMAIN` | *(empty)* | empty = host-only cookies (recommended; browsers reject `Domain=localhost`) |
| `COOKIE_SECURE` | `false` (dev) | defaults to `true` when `NODE_ENV=production` |
| `BCRYPT_COST` | `12` | 4–15; below 10 only when `NODE_ENV=test` |
| `MIGRATE_ON_START` | `true` (dev) | run pending migrations at API start; defaults to `false` in production (12 §4) |
| `LOG_LEVEL` | `info` | |
| `LOG_PRETTY` | `true` | dev only |
| `CACHE_ENABLED` | `true` | |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `300` | |
| `EMAIL_PROVIDER` | `mock` | mock / smtp / (later: ses, sendgrid) |
| `SMS_PROVIDER` | `mock` | mock / (later: twilio, msg91) |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` | | used when `EMAIL_PROVIDER=smtp` (Mailpit in docker) |
| `RUN_RELAY_IN_WORKER` | `true` | |
| `OUTBOX_ENCRYPTION_KEY` | (32-byte base64) | encrypts secrets in outbox payloads (see 09 §7) |
| `UPLOADS_DIR` | `uploads` | local ObjectStorage directory (relative to `backend/`; `/app/backend/uploads` volume in Docker), served by the API at `/uploads` (Phase 4) |
| `UPLOADS_PUBLIC_URL` | `http://localhost:4000/uploads` | required; browser-facing URL of `/uploads`, stored in `services.imageUrl` / `staff.photoUrl`. An S3 adapter would use a bucket/CDN URL instead |
| `SWAGGER_ENABLED` | `true` | false in prod unless protected |
| `METRICS_ENABLED` | `true` | |

## 4. Error handling
- Base class `AppError(statusCode, code, message, details?)`.
- Subclasses: `ValidationError 400`, `UnauthorizedError 401`, `ForbiddenError 403`, `NotFoundError 404`, `ConflictError 409`, `BusinessRuleError 422`, `TooManyRequestsError 429`, `ServiceUnavailableError 503` (code `TEMPORARILY_UNAVAILABLE`, used when a required dependency such as the booking lock store is down, see 08 §5).
- Response format: RFC 7807 `application/problem+json`:
```json
{
  "type": "https://straightsalon.dev/errors/slot-unavailable",
  "title": "Slot no longer available",
  "status": 409,
  "code": "SLOT_UNAVAILABLE",
  "detail": "The selected stylist is no longer free at 11:00.",
  "instance": "/api/v1/bookings",
  "requestId": "6f1c...",
  "errors": [ { "path": "startAt", "message": "..." } ]
}
```
- Unknown errors → 500 with generic message; full stack logged at `error` level, never returned to client.
- Mongo duplicate key (11000) → 409 `DUPLICATE`. Mongoose `VersionError` → 409 `STALE_VERSION`.

## 5. Business rules (BR)

| ID | Rule |
|---|---|
| BR-001 | Booking `startAt` must align to `slotGranularityMin` in salon timezone. Walk-ins (`checkInNow`) start at the current slot boundary or the next free aligned slot (00 US-03). |
| BR-002 | `startAt` ≥ now + `minLeadTimeMin` (not enforced for staff/receptionist/admin). |
| BR-003 | `startAt` ≤ today + `maxAdvanceDays`. |
| BR-004 | No overlap for same stylist among active statuses (`BOOKED`, `CHECKED_IN`, `IN_SERVICE`) using `[startAt, blockedUntil)`. |
| BR-005 | Booking must fit inside salon hours, the stylist's working hours, outside breaks, outside time-off, and not on a holiday. |
| BR-006 | Customer may cancel/reschedule only if `startAt - now ≥ cancellationCutoffMin`. Receptionist/admin may override with `override: true` and mandatory reason (audited). |
| BR-007 | Stylist must be active and have every selected service in `serviceIds`. All services must be active. |
| BR-008 | 1–5 services per booking; no duplicates. |
| BR-009 | A customer may hold at most 3 future `BOOKED` bookings (prevents slot hoarding). Not applied to bookings created by RECEPTIONIST/ADMIN on a customer's behalf. |
| BR-010 | Status transitions only along the allowed graph (FR-040). Invalid transition → 422 `INVALID_STATUS_TRANSITION`. |
| BR-011 | Payment can only be recorded when status is `COMPLETED`; `amountPaidMinor + discountMinor` must equal `totalPriceMinor`; discount > 0 requires reason. |
| BR-012 | Review only by the booking's customer, booking `COMPLETED`, within `reviewWindowDays`, one per booking. |
| BR-013 | Service duration must be a multiple of `slotGranularityMin`. |
| BR-014 | Deactivating a stylist with future active bookings is blocked (422) unless `force: true`, which cancels them and notifies customers. |
| BR-015 | Rescheduling = atomic change of `startAt`/`staffId` on the same booking (same `bookingRef`), re-validating BR-001..BR-007. |

### 5.1 Booking creation algorithm (BR-004 enforcement)
```
1. Validate input (Zod). Load settings (cached), services, stylist (or resolve "any").
2. Check BR-001, 002, 003, 005, 007, 008, 009 → 422 on failure.
3. Acquire Redis lock `ss:v1:lock:staff:{staffId}:{yyyy-mm-dd}` (TTL 5s, retry 3x with jitter).
     - Lock held by someone else after retries → 409 SLOT_UNAVAILABLE ("please retry").
     - Redis unreachable → 503 TEMPORARILY_UNAVAILABLE (08 §5).
4. Start Mongo transaction (withTransaction, retries transient errors):
     a. Upsert/increment the staff-day guard `{staffId, date}` (02 §2.18). This makes concurrent
        transactions for the same stylist/day conflict, so BR-004 holds even without the lock.
     b. Query overlapping active bookings for staffId (indexed). If any → abort, 409 SLOT_UNAVAILABLE.
     c. Insert booking.
     d. Insert audit log entry (same session).
     e. Insert outbox event `booking.created` (same session).
5. Commit; release lock (only if token matches).
6. Invalidate availability cache keys for that staff/date (see 08-caching).
7. Return 201 with booking DTO.
```
For "any stylist", iterate candidates ordered per FR-033 and attempt steps 3–5 for each until one succeeds.
Reschedule (BR-015) follows the same steps, applying the guard for the *target* stylist/date (and the lock for it); the old slot needs no guard.
The Redis lock only reduces contention and write-conflict retries. Correctness comes from the guard document plus the transaction.

### 5.2 Availability algorithm (`GET /availability`)
```
Input: serviceIds[], staffId | "any", date (salon tz)
1. totalDuration = sum(durations); required span = totalDuration + bufferMin.
2. If date is holiday or salon closed → [].
3. Candidates = active staff who can perform all services (or the one requested).
4. For each candidate:
     window = intersect(salon hours, staff weekly hours for weekday)
     free   = window − breaks − time_off − existing active bookings [startAt, blockedUntil)
     slots  = every granularity-aligned t in free where [t, t+span) ⊆ free
5. Lead-time filter (customers / public only): drop t < now + minLeadTime. Also drop t < now for everyone.
6. Response: { date, slots: [ { startAt, staffIds: [...] } ] }   (for "any": union with stylists free at each t)
```
Step 4's per-stylist result is what gets cached (08 §2). It does not depend on the caller's role or the current time; step 5 is applied after reading from the cache.
Implemented as pure functions in `shared/time/slots.ts` — **this must have near 100% unit test coverage** with edge cases (DST irrelevant for IST but tests must use tz-aware helpers anyway, breaks at boundaries, back-to-back bookings, buffer, end-of-day).

## 6. Health and ops endpoints
- `GET /health/live` → 200 `{ status: "ok" }` (process alive, no dependency checks).
- `GET /health/ready` → pings Mongo and Redis (2 s timeout each) and returns per-dependency status. Mongo is **critical** and Redis is **non-critical**, which reconciles this section with 08 §1 ("if Redis is down … readiness stays OK"):

  | Situation | HTTP | Body `status` |
  |---|---|---|
  | All up | 200 | `ok` |
  | Redis down, Mongo up | 200 | `degraded` (cache falls back to Mongo; locks/rate limits degrade per 08 §5) |
  | Mongo down | 503 | `error` |
  | Shutting down (SIGTERM received) | 503 | `shutting_down` (no checks run) |

  Body: `{ "status": "degraded", "checks": { "mongo": { "status": "up" }, "redis": { "status": "down" } } }`. Error details are logged at `warn`, never returned (the endpoint is public).
- At startup, a Mongo connection failure is fatal (log `fatal`, exit 1, 07 §1.2). A Redis failure is not: the client reconnects in the background, and readiness reports `degraded` meanwhile.
- `GET /metrics` → Prometheus metrics (HTTP duration histogram by route/status, queue depth, outbox pending count) when `METRICS_ENABLED`.
- `GET /api/docs` → Swagger UI; `GET /api/docs/openapi.json` → raw spec.

## 7. Graceful shutdown
On `SIGTERM`/`SIGINT`: mark readiness as failing → stop HTTP server accepting new connections → wait for in-flight requests (max 10s) → close BullMQ workers/queues → close Redis → close Mongo → exit 0. Workers finish current job before closing.
Implemented by `registerShutdown(logger, steps)` in `shared/lifecycle`, shared by all entrypoints: steps run in order, a failing step is logged and the rest still run (exit 1), and the whole sequence is capped at 10 s (forced exit 1). Redis is closed with `QUIT` when connected and by dropping the socket when it is unreachable.

## 8. Pagination, filtering, sorting conventions
- Query: `?page=1&pageSize=20&sort=-startAt&status=BOOKED`.
- `pageSize` max 100. Response envelope:
```json
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 134, "totalPages": 7 } }
```
- Single-resource responses return the object directly (no envelope).

## 9. Idempotency
`POST /bookings` and `POST /bookings/{id}/payment` accept an optional `Idempotency-Key` header. The first response is cached in Redis for 24h under `ss:v1:idem:{userId}:{key}` (key builder in `shared/cache/keys.ts`, 08 §2); repeats return the stored response with header `Idempotent-Replayed: true`. Same key with a different body → 422 `IDEMPOTENCY_KEY_REUSED`. Details (decision 2026-10-07, `shared/http/idempotency.ts`): the key is reserved (`SET NX`, 60 s) before the request runs, so a repeat while the first is still running gets 409 `IDEMPOTENCY_KEY_REUSED` (a double-clicked confirm cannot book two stylists via "any"); only 2xx responses are stored, an error releases the key so the client can retry with it; keys are 8–100 characters of `[A-Za-z0-9_-]` (400 otherwise); if Redis is unreachable the request runs without idempotency (warn, at most once a minute).
