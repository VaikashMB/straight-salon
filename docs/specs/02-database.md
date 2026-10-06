# 02 — Database (MongoDB)

## 1. General rules
- MongoDB 7+ (local Docker image: `mongo:8.2` for now; see 11 §1 for the kernel-compatibility reason and the plan to return to 8.0), running as a **single-node replica set** (`rs0`) locally so multi-document transactions work. Required for booking creation and the outbox.
- Optional fields covered by a **sparse** unique index (e.g. `users.email`) must be omitted when empty, never stored as `null`, or the index treats every `null` as a duplicate.
- ODM: Mongoose `[Mongo][Node]`. Every schema has `timestamps: true` (`createdAt`, `updatedAt`, stored UTC).
- Collection names: `snake_case`, plural. Field names: `camelCase`.
- IDs: MongoDB `ObjectId`. API exposes them as `id` (string).
- Soft delete via `isActive` / `deletedAt` for business entities; hard deletes only for tokens and transient data.
- Money: integer minor units (`priceMinor: 50000` = ₹500.00 / $500.00 depending on currency setting).
- Optimistic concurrency: enable Mongoose `optimisticConcurrency: true` on `bookings`, `services`, `staff`, `settings`.
- Every query used by an endpoint must be backed by an index listed here. Add new indexes to this file when adding queries.
- Schema migrations: `migrate-mongo` in `backend/src/db/migrations`. Never change data shapes without a migration.

> When rebuilding in a relational stack, each collection maps to a table; embedded arrays (`services` in booking, `breaks` in schedule) become child tables.

## 2. Collections

### 2.1 `users`
| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | |
| `name` | string | required, 2–80 chars |
| `email` | string | lowercase, unique **sparse** (walk-ins may lack email) |
| `phone` | string | E.164 format, unique |
| `passwordHash` | string | bcrypt, `select: false`; absent for walk-in customers |
| `role` | enum | `CUSTOMER`, `STAFF`, `RECEPTIONIST`, `ADMIN` |
| `isActive` | bool | default true |
| `isWalkIn` | bool | true for counter-created customers without login |
| `preferences` | object | `{ preferredStaffId?: ObjectId, smsOptIn: bool (default true), emailOptIn: bool (default true) }` |
| `lastLoginAt` | Date | |
| `passwordChangedAt` | Date | used to invalidate older tokens |

Indexes: `{ email: 1 } unique sparse`, `{ phone: 1 } unique`, `{ role: 1, isActive: 1 }`, text index on `name`.

### 2.2 `refresh_tokens`
| Field | Type | Rules |
|---|---|---|
| `userId` | ObjectId | ref users |
| `tokenHash` | string | SHA-256 of the opaque token; never store raw |
| `family` | string | UUID; all rotations of one login share a family (reuse detection) |
| `expiresAt` | Date | |
| `revokedAt` | Date | null if active |
| `replacedByHash` | string | set on rotation |
| `userAgent`, `ip` | string | for "active sessions" view |

Indexes: `{ tokenHash: 1 } unique`, `{ userId: 1 }`, `{ family: 1 }`, TTL `{ expiresAt: 1 }, expireAfterSeconds: 0`.

### 2.3 `password_reset_tokens`
`userId`, `tokenHash`, `expiresAt` (30 min), `usedAt`. Indexes: `{ tokenHash: 1 } unique`, TTL on `expiresAt`.

### 2.4 `service_categories`
`name` (unique), `slug` (unique), `description`, `sortOrder` (int), `isActive`.

### 2.5 `services`
| Field | Type | Rules |
|---|---|---|
| `name` | string | required, unique among active |
| `slug` | string | unique |
| `categoryId` | ObjectId | ref service_categories |
| `description` | string | ≤ 1000 chars |
| `durationMin` | int | > 0, multiple of `settings.slotGranularityMin` |
| `priceMinor` | int | ≥ 0 |
| `imageUrl` | string | optional |
| `isActive` | bool | |
| `ratingAvg`, `ratingCount` | number | denormalised, updated by event consumer |

Indexes: `{ slug: 1 } unique`, `{ categoryId: 1, isActive: 1 }`, text index on `name, description`.

### 2.6 `staff`
| Field | Type | Rules |
|---|---|---|
| `userId` | ObjectId | ref users (role STAFF), unique |
| `displayName` | string | |
| `bio` | string | ≤ 500 |
| `photoUrl` | string | |
| `serviceIds` | ObjectId[] | services this stylist can perform |
| `isActive` | bool | |
| `ratingAvg`, `ratingCount` | number | denormalised |

Indexes: `{ userId: 1 } unique`, `{ serviceIds: 1, isActive: 1 }`.

### 2.7 `staff_schedules`
One document per staff member.
```
{
  staffId: ObjectId (unique),
  weekly: [
    { dayOfWeek: 0-6, isWorking: bool, start: "10:00", end: "19:00",
      breaks: [ { start: "13:30", end: "14:15" } ] }
  ]
}
```
Times are local wall-clock in salon timezone ("HH:mm"). Exactly 7 entries.

### 2.8 `time_off`
`staffId`, `startAt` (UTC), `endAt` (UTC), `reason`, `createdBy`. Index `{ staffId: 1, startAt: 1, endAt: 1 }`.

### 2.9 `holidays`
`date` ("YYYY-MM-DD", unique), `name`.

### 2.10 `settings` (singleton, `_id: "salon"`)
```
{
  _id: "salon",
  name: "Straight Salon", address, phone, email,
  timezone: "Asia/Kolkata",           // IANA tz, configurable
  currency: "INR",                    // ISO 4217, configurable
  businessHours: [ { dayOfWeek, isOpen, open: "09:30", close: "20:30" } ],  // 7 entries
  slotGranularityMin: 15,
  bufferMin: 0,
  minLeadTimeMin: 60,
  maxAdvanceDays: 30,
  cancellationCutoffMin: 120,
  noShowGraceMin: 30,
  reviewWindowDays: 14
}
```

### 2.11 `bookings` (core)
| Field | Type | Rules |
|---|---|---|
| `bookingRef` | string | human-friendly, unique, e.g. `SS-260412-7KQ2` (`YYMMDD` = appointment date at creation, salon tz). Kept unchanged on reschedule (BR-015), so treat it as an opaque identifier, not a date source. |
| `customerId` | ObjectId | ref users |
| `staffId` | ObjectId | ref staff |
| `services` | array | snapshot: `[{ serviceId, name, durationMin, priceMinor }]` |
| `startAt` | Date | UTC |
| `endAt` | Date | UTC = startAt + total duration |
| `blockedUntil` | Date | endAt + bufferMin (used for overlap checks) |
| `totalDurationMin` | int | |
| `totalPriceMinor` | int | |
| `status` | enum | `BOOKED`, `CHECKED_IN`, `IN_SERVICE`, `COMPLETED`, `CANCELLED`, `NO_SHOW` |
| `statusHistory` | array | `[{ status, at, by (userId|"system"), note }]` |
| `source` | enum | `ONLINE`, `WALK_IN`, `PHONE` |
| `notes` | string | customer notes ≤ 300 |
| `cancellation` | object | `{ at, by, reason, overridden: bool }` |
| `payment` | object | `{ status: UNPAID|PAID, method, amountPaidMinor, discountMinor, discountReason, recordedBy, recordedAt }` |
| `reminders` | object | `{ h24SentAt, h2SentAt }` |
| `createdBy` | ObjectId | |
| `version` | int | optimistic concurrency (`__v`) |

Indexes:
- `{ bookingRef: 1 } unique`
- `{ staffId: 1, startAt: 1 }` — availability & overlap checks
- `{ customerId: 1, startAt: -1 }` — "my bookings"
- `{ status: 1, startAt: 1 }` — no-show job, reminders, dashboard
- `{ startAt: 1 }` — reports by range

**Overlap invariant (BR-004):** for a given `staffId`, no two bookings with status in `BOOKED|CHECKED_IN|IN_SERVICE` may satisfy `a.startAt < b.blockedUntil && b.startAt < a.blockedUntil`. MongoDB has no exclusion constraint, so this is enforced in the service layer inside a transaction that also writes a **staff-day guard** document (§2.18), plus a Redis lock to reduce contention (see 03-backend §5.1).

> Why the guard is needed: a transaction that reads "no overlap" and then inserts a new booking does not conflict with another transaction doing the same for a *different* new booking (snapshot isolation allows this "write skew"). Both would commit. Writing the same guard document in both transactions turns the race into a write conflict, so one of them aborts.

### 2.12 `reviews`
`bookingId` (unique), `customerId`, `staffId`, `serviceIds[]`, `rating` (1–5), `comment` (≤ 500), `isHidden`, `hiddenBy`, `hiddenReason`.
Indexes: `{ bookingId: 1 } unique`, `{ staffId: 1, isHidden: 1, createdAt: -1 }`.

### 2.13 `notifications`
`userId`, `channel` (`EMAIL|SMS`), `template` (e.g. `booking_confirmed`), `to`, `payload` (object), `status` (`QUEUED|SENT|FAILED`), `provider`, `providerMessageId`, `error`, `attempts`, `sentAt`, `dedupeKey` (unique).
Indexes: `{ dedupeKey: 1 } unique`, `{ userId: 1, createdAt: -1 }`, TTL 180 days on `createdAt`.

### 2.14 `audit_logs` (append-only)
See 07-logging-and-auditing for semantics.
`at`, `actor: { id, role, ip, userAgent }`, `action` (e.g. `booking.cancel`), `entityType`, `entityId`, `before` (object|null), `after` (object|null), `diff` (array of changed paths), `requestId`, `metadata`.
Indexes: `{ entityType: 1, entityId: 1, at: -1 }`, `{ "actor.id": 1, at: -1 }`, `{ action: 1, at: -1 }`, `{ at: -1 }`.
The application DB user must have **insert/find only** on this collection (no update/delete) — enforced via a dedicated Mongo role in `infra/docker/mongo-init.js`.

### 2.15 `outbox_events`
`eventId` (UUID, unique), `type` (e.g. `booking.created`), `aggregateType`, `aggregateId`, `payload`, `occurredAt`, `status` (`PENDING|PUBLISHING|PUBLISHED|FAILED`), `claimedAt` (set when a relay claims the row, see 09 §4), `publishedAt`, `attempts`, `lastError`.
Indexes: `{ eventId: 1 } unique`, `{ status: 1, occurredAt: 1 }`, `{ status: 1, claimedAt: 1 }` (stale-claim reset), TTL 7 days on `publishedAt`.

### 2.16 `processed_events` (consumer idempotency)
`consumer` (string), `eventId` (string), `processedAt`. Index `{ consumer: 1, eventId: 1 } unique`, TTL 7 days.

### 2.17 `daily_stats` (read model for reports)
`date` ("YYYY-MM-DD", salon tz), `staffId` (nullable = salon total), `bookings`, `completed`, `cancelled`, `noShows`, `revenueMinor`, `bookedMinutes`, `availableMinutes`, `byService: [{ serviceId, count, revenueMinor }]`.
Index `{ date: 1, staffId: 1 } unique`. Rebuildable from `bookings` via `npm run stats:rebuild`.

### 2.18 `staff_day_guards` (BR-004 concurrency guard)
`staffId`, `date` ("YYYY-MM-DD", salon tz), `seq` (int). Index `{ staffId: 1, date: 1 } unique`.
Every transaction that creates or moves an active booking (create, reschedule, walk-in), or creates time-off for a stylist, does `updateOne({ staffId, date }, { $inc: { seq: 1 } }, { upsert: true, session })` for each affected stylist/date **before** running its overlap query. Concurrent transactions on the same stylist/day then hit a write conflict; the driver's transient-error retry re-runs the loser, whose overlap check now sees the winner's booking. If two transactions race to *create* the same guard row, the loser gets a duplicate-key error (11000); `withTransaction` treats that as retryable for this collection. Cancellations and status exits do not need the guard (freeing time cannot create an overlap). No TTL: old rows are tiny and serve as a per-day change counter.

## 3. Seed data (`npm run db:seed`)
Idempotent seed for local dev and e2e tests. It grows with the build plan: each phase seeds only the collections that exist so far (admin user in Phase 3; settings, users, catalogue, staff, schedules, holidays and time-off in Phase 4; bookings and payments in Phase 5; reviews in Phase 7). The complete seed below is what exists by Phase 7.
- Settings singleton with defaults above.
- Users: 1 admin (`admin@straightsalon.local`), 1 receptionist, 4 staff, 10 customers. Password for all: `Password@123` (dev only; seed refuses to run when `NODE_ENV=production`).
- Categories: Hair, Beard & Grooming, Skin, Nails.
- ~15 services across categories with realistic durations (15–120 min) and prices.
- Staff schedules (one stylist off on Mondays), one holiday next month, a few time-off blocks.
- ~60 bookings spread over past 14 days and next 7 days across all statuses, with payments on completed ones, and a handful of reviews.
