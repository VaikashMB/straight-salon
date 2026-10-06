# 07 — Logging & Auditing

Logging and auditing are **different things** and must not be mixed:

| | Logging | Auditing |
|---|---|---|
| Purpose | Operate & debug the system | Accountability: who changed what, when |
| Audience | Developers / ops | Owner / admins / compliance |
| Storage | stdout → (later) Loki/ELK/CloudWatch | MongoDB `audit_logs` (append-only) |
| Retention | Short (days–weeks) | Long (≥ 1 year) |
| Content | Technical events, errors, timings | Business mutations with before/after |
| Can be sampled/dropped? | Yes | Never |

## 1. Logging

### 1.1 Format
Pino JSON, one line per event, to stdout. In development, `LOG_PRETTY=true` pipes through `pino-pretty`.
```json
{
  "level": "info", "time": "2026-10-06T09:12:44.123Z",
  "service": "straight-salon-api", "env": "development", "version": "1.0.0",
  "process": "api", "pid": 42, "hostname": "api-7f9c",
  "requestId": "6f1c2a8e-...", "userId": "6712...", "role": "CUSTOMER",
  "module": "bookings", "msg": "Booking created",
  "bookingId": "6712...", "staffId": "6711...", "durationMs": 38
}
```
- `service`, `env`, `version`, `process` are base fields on every line.
- `requestId`, `userId`, `role` are injected automatically from AsyncLocalStorage (`requestContext`) via a Pino `mixin`, so business code just calls `logger.info({ bookingId }, 'Booking created')`.
- Workers create a context per job: `requestId` = the originating request's ID carried in the event metadata (`correlationId`), plus `jobId`, `queue`, `eventType`. This links an HTTP request to the emails it caused.

### 1.2 Levels
| Level | Use for |
|---|---|
| `fatal` | Process cannot continue (cannot connect to DB at boot) |
| `error` | Unhandled errors, 5xx, job failed after final retry |
| `warn` | Handled but suspicious: refresh token reuse, rate limit hit, retrying job, slow query > 500 ms |
| `info` | Request completed (access-log middleware), business milestones (booking created/cancelled), startup/shutdown |
| `debug` | Detailed flow (availability calculation inputs/outputs), cache hit/miss |
| `trace` | Not used in v1 |

Default `LOG_LEVEL=info` (dev may use `debug`). Tests use `silent`.

### 1.3 HTTP access logs (`shared/http/accessLog.ts`)
Log on response finish: method, route pattern (not raw URL with IDs, to keep cardinality low), status, `responseTimeMs`, `contentLength`, `userAgent`. 5xx → `error`, 4xx → `warn` (except 401/404 → `info`), else `info`. Skip `/health/*` and `/metrics`.

### 1.4 Redaction (PII and secrets) — mandatory
Redact paths: `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, `*.password`, `*.newPassword`, `*.currentPassword`, `*.passwordHash`, `*.token`, `*.accessToken`, `*.refreshToken`, `*.email`, `*.phone`. A unit test asserts these never appear in output.

### 1.5 What must be logged
- App start (config summary without secrets), ready, shutdown.
- Each Mongo/Redis connection state change.
- Every error passing through the error middleware (with `err` serializer, stack).
- Outbox relay: batch published count, failures.
- Each job: start (debug), success (info with duration), failure (warn per attempt, error final).
- Slow Mongo queries (Mongoose debug hook in dev, > 500 ms → warn).

## 2. Auditing

### 2.1 What gets audited
Every create/update/delete/state-change of a business entity, plus security events:

| Action | Entity |
|---|---|
| `auth.login`, `auth.login_failed`, `auth.logout`, `auth.logout_all`, `auth.password_changed`, `auth.password_reset`, `auth.refresh_reuse_detected` | user |
| `user.create`, `user.update`, `user.deactivate`, `user.role_change` | user |
| `settings.update` | settings |
| `category.*`, `service.create/update/deactivate` | category/service |
| `staff.create/update/deactivate`, `staff.schedule_update`, `timeoff.create/delete` | staff |
| `holiday.create/delete` | holiday |
| `booking.create`, `booking.reschedule`, `booking.cancel`, `booking.status_change`, `booking.override` | booking |
| `payment.record` | booking |
| `review.create`, `review.hide/unhide` | review |
| System actions (auto no-show) | booking, with `actor: { id: "system", role: "SYSTEM" }` |

### 2.2 Audit record
```json
{
  "at": "2026-10-06T09:12:44.123Z",
  "actor": { "id": "6712...", "role": "RECEPTIONIST", "ip": "10.0.0.5", "userAgent": "..." },
  "action": "booking.cancel",
  "entityType": "booking",
  "entityId": "6713...",
  "before": { "status": "BOOKED" },
  "after":  { "status": "CANCELLED", "cancellation": { "reason": "Customer called", "overridden": true } },
  "diff": ["status", "cancellation"],
  "requestId": "6f1c2a8e-...",
  "metadata": { "override": true }
}
```
- `before`/`after` contain only the relevant (changed) fields, with the same PII redaction as logs for `users` (email/phone masked: `a***@x.com`, `+9198******12`).
- Written via `auditService.record(entry, session)` **inside the same Mongo transaction** as the change, so an action is never committed without its audit row (and vice versa). Security events that change no data (`auth.login_failed`, `auth.refresh_reuse_detected`, `auth.logout`) are written without a transaction. Each detected refresh-token reuse is audited, so replaying several revoked tokens gives several rows.
- `diff` produced by a shared utility comparing plain objects (deep, path list).

### 2.3 Immutability
- Repository exposes only `insert` and `find`; no update/delete methods exist in code.
- Mongo role for the app user grants only `insert`, `find` on `audit_logs` (see `infra/docker/mongo-init.js`).
- Audit read API is ADMIN-only (API-073). Reading audit logs is itself not audited in v1.

### 2.4 Tests required
- Each audited action produces exactly one audit row with correct actor, action, entityId, diff.
- If the business write fails, no audit row exists (transaction rollback).
- PII masking in `before/after` for user entities.
