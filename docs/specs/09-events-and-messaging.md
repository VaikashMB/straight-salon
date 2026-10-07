# 09 — Events & Message Processing

## 1. Why
Side effects (sending emails/SMS, updating ratings, recalculating stats, invalidating caches on other instances) must not slow down or break the user's request, and must not be lost if a process crashes. We use:
1. **Domain events** describing facts that happened (`booking.created`).
2. **Transactional outbox** so an event is persisted atomically with the state change.
3. **Message queue** (BullMQ on Redis in v1) to deliver events to **consumers** in a separate worker process, with retries and dead-lettering.

## 2. Event envelope
```ts
interface DomainEvent<T> {
  eventId: string;          // UUID v4
  type: string;             // e.g. "booking.created"
  version: 1;               // payload schema version
  occurredAt: string;       // ISO UTC
  aggregateType: string;    // "booking"
  aggregateId: string;
  actor: { id: string; role: string };  // "system" for jobs
  correlationId: string;    // originating requestId
  payload: T;
}
```
Payloads are defined with Zod in `shared/events/registry.ts`; publishing an event whose payload fails validation throws (caught by tests).
Payloads include IDs and the minimal data consumers need; consumers re-fetch fresh data when needed. No passwords/tokens ever.

## 3. Event catalogue

| ID | Type | Emitted when | Key payload fields |
|---|---|---|---|
| EVT-001 | `user.registered` | API-001 | userId |
| EVT-002 | `user.password_reset_requested` | API-006 (user exists) | userId, resetUrl token reference (token itself passed only to email consumer via encrypted field or re-generated — see §7) |
| EVT-010 | `booking.created` | API-050 | bookingId, customerId, staffId, startAt, endAt, source |
| EVT-011 | `booking.rescheduled` | API-054 | bookingId, from{startAt,staffId}, to{startAt,staffId} |
| EVT-012 | `booking.cancelled` | API-055, BR-014 force | bookingId, staffId, startAt, cancelledBy, reason |
| EVT-013 | `booking.status_changed` | API-056, auto no-show job | bookingId, from, to |
| EVT-014 | `booking.completed` | status → COMPLETED | bookingId, staffId, serviceIds, totalPriceMinor |
| EVT-015 | `booking.no_show` | API-056 or auto job | bookingId, staffId |
| EVT-016 | `booking.payment_recorded` | API-057 | bookingId, amountPaidMinor, method |
| EVT-017 | `booking.reminder_due` | `reminders-24h` / `reminders-2h` jobs (§7) | bookingId, customerId, startAt, window (`24h`\|`2h`) |

Every status change emits EVT-013. A change to `COMPLETED` **also** emits EVT-014, and a change to `NO_SHOW` **also** emits EVT-015, in the same transaction. EVT-013 serves generic consumers (cache invalidation, history); the specific events serve consumers that only care about that outcome (thank-you email, stats).
| EVT-020 | `review.created` | API-060 | reviewId, staffId, serviceIds, rating |
| EVT-021 | `review.visibility_changed` | API-062 | reviewId, isHidden |
| EVT-030 | `staff.updated` / `staff.schedule_changed` / `staff.timeoff_changed` | staff APIs | staffId, affected dates |
| EVT-031 | `catalog.changed` | category/service APIs | entityType, entityId |
| EVT-032 | `settings.changed` | API-018 | changed keys |
| EVT-033 | `holiday.changed` | API-020 | date |

## 4. Transactional outbox
**Write side** (inside the service's Mongo transaction):
```ts
await outbox.add(session, { type: 'booking.created', aggregateType: 'booking', aggregateId, payload });
```
**Relay** (`relay.ts`, or inside worker when `RUN_RELAY_IN_WORKER=true`):
1. Every 500 ms (and immediately when woken by a MongoDB **change stream** on `outbox_events` inserts — change streams work because we run a replica set), fetch up to 100 `PENDING` events ordered by `occurredAt`.
2. Claim each with `findOneAndUpdate({ _id, status: 'PENDING' }, { $set: { status: 'PUBLISHING', claimedAt } })` so multiple relay instances don't double-publish.
3. Publish to the `EventBus`; on success set `PUBLISHED`; on failure increment `attempts`, set back to `PENDING` with `lastError`; after 10 attempts → `FAILED` + error log.
4. Stale `PUBLISHING` claims older than 60 s are reset to `PENDING`.
Delivery guarantee: **at-least-once**. Therefore every consumer must be idempotent (§6).

## 5. EventBus and queues
`EventBus` interface (`shared/events/EventBus.ts`):
```ts
interface EventBus {
  publish(event: DomainEvent<unknown>): Promise<void>;
  subscribe(consumerName: string, eventTypes: string[], handler: (e) => Promise<void>, opts?): void;
}
```
**BullMQ adapter (v1):** one queue per consumer (fan-out done by the adapter: `publish` adds the event to every queue whose consumer subscribed to that type). Job ID = `eventId` so BullMQ itself drops a duplicate publish into the same queue (BullMQ rejects `:` in custom job IDs, so the consumer cannot be part of the ID; the per-consumer queue already scopes it). The consumer → event-types routing table is static (`shared/events/subscriptions.ts`), so the relay process can fan out without knowing which worker runs each consumer. Queue key prefix `ss`.

Future adapters: `RabbitMqEventBus` (topic exchange `ss.events`, one queue per consumer, routing key = event type), `KafkaEventBus` (topic per aggregate). Modules never import BullMQ directly.

### Consumers (in `workers/`)
| Consumer | Subscribes to | Does |
|---|---|---|
| `notifications` | user.registered, user.password_reset_requested, booking.created/rescheduled/cancelled/no_show, booking.completed (thank-you + review link), booking.reminder_due (respects `smsOptIn`, FR-054) | Renders template, sends via provider for each opted-in channel, records in `notifications` with `dedupeKey = eventId:channel:template`. A reminder whose booking is no longer `BOOKED` or has moved since it was queued is skipped |
| `staff-notifications` | booking.created/rescheduled/cancelled | Notifies assigned stylist (old and new stylist on reassign) |
| `cache-invalidation` | booking.*, staff.*, catalog.changed, settings.changed, holiday.changed, review.* | Invalidates cache tags (see 08) |
| `ratings` (Phase 7) | review.created, review.visibility_changed | Recomputes `ratingAvg/ratingCount` for staff & services |
| `stats` (Phase 7) | booking.created/cancelled/completed/no_show/payment_recorded, booking.rescheduled | Recomputes `daily_stats` for affected dates/staff (recompute-from-source, not increment, so it is idempotent) |

**Channels (decision 2026-10-07).** Account messages (`welcome`, `password_reset`) go by email only, and always when the user has an address: they are not optional. Booking messages, to customers and to stylists, go by email when there is an address and `emailOptIn` is on, and by SMS when `smsOptIn` is on (FR-054). Walk-ins without an email get SMS only. Deactivated accounts get nothing. Channels are sent one after the other; a failure retries the job, and channels already sent are skipped by their `dedupeKey`.

**Stylists (FR-052).** `booking.created` → `staff_booking_assigned`; a reschedule with the same stylist → `staff_booking_changed`; a reassignment → `staff_booking_assigned` to the new stylist and `staff_booking_cancelled` to the old one (showing the slot they had); `booking.cancelled` → `staff_booking_cancelled`. Staff messages show the customer's first name only (00 US-04).

### Queue settings (defaults)
- Attempts: 5, exponential backoff starting 2 s (2, 4, 8, 16, 32 s).
- Concurrency: notifications 5, others 10.
- Completed jobs kept 1 day / max 1000; failed kept 7 days.
- Failed after final attempt → stays in BullMQ failed set (acts as **dead-letter queue**) + error log. Admin script `npm run queues:retry-failed -- --queue=notifications` re-queues them.
- Optional dev UI: **Bull Board** mounted at `/admin/queues` on the API (ADMIN-only, disabled in prod by default via `BULL_BOARD_ENABLED`). A browser cannot send the bearer token to that page and the refresh cookie is scoped to `/api/v1/auth`, so it uses **HTTP Basic** with an active ADMIN's email and password (decision 2026-10-07): the browser shows its own prompt, the same lockout as login applies (06 §2), failures are audited as `auth.login_failed` with `metadata.channel: "queues-board"`, and accepted credentials are remembered (as a hash, in memory) for 60 s because the board polls. Failed jobs can be retried from the board as well as with the script.
- `GET /metrics` reports `queue_jobs{queue,state}` (waiting, active, delayed, failed) for every queue; the read gives up after 1 s so a scrape never hangs while Redis is down.

## 6. Idempotency in consumers
Wrapper `idempotent(consumerName, handler)`:
1. Try `insert processed_events { consumer, eventId }` (unique index).
2. Duplicate key → already processed → log debug, ack.
3. Else run handler; if handler throws, delete the `processed_events` row so the retry can run.
Plus natural idempotency (e.g. `notifications.dedupeKey`, stats recompute).

## 7. Scheduled jobs (BullMQ Job Schedulers in worker)
| Job | Schedule | Does |
|---|---|---|
| `reminders-24h` | every 5 min | Find `BOOKED` bookings with `startAt` in (now+23h55m, now+24h] and `reminders.h24SentAt` null. For each, in one transaction: set `h24SentAt` (atomic `findOneAndUpdate` on `h24SentAt: null` guards duplicates) and write outbox event EVT-017 `booking.reminder_due` |
| `reminders-2h` | every 5 min | Same for 2 h window and `h2SentAt` |

The reminder windows are as wide as the job interval, so consecutive runs tile the timeline. A reschedule (API-054) clears both reminder flags, so the new time gets its own reminders (decision 2026-10-07); a reminder queued for the old time is skipped by the consumer.
| `auto-no-show` | every 5 min | `BOOKED` bookings with `startAt < now − noShowGraceMin` → status `NO_SHOW` (system actor), audit + outbox events EVT-013 and EVT-015 |
| `outbox-cleanup` | daily 03:00 salon tz | Remove `FAILED` older than 30 days after logging summary (TTL handles published) |
| `stats-reconcile` (Phase 7) | daily 02:00 salon tz | Recompute yesterday's `daily_stats` from bookings (self-healing) |

Schedules are registered with `queue.upsertJobScheduler(<fixed scheduler id>, { every | pattern, tz: <salon timezone> }, template)` on the `scheduled-jobs` queue. Upserting by a fixed ID means running multiple worker replicas, or restarting, never duplicates a schedule; schedulers whose job no longer exists are removed at start. (This replaces BullMQ's deprecated repeatable-jobs API.) Each run gets its own logging/audit context (`requestId = job-<id>-<runId>`), so events and audit rows from a job link to that run. Cron patterns use the salon timezone read when the worker starts; restart the worker after changing the timezone. Jobs run as the system actor (`{ id: "system", role: "SYSTEM" }`), retry 3 times with backoff, and run one at a time per worker.

**Password reset token handling:** the API generates the raw token, stores its hash, and writes the raw token into the envelope field `secret` (next to, not inside, `payload`, so payload validation and logging never see it), encrypted with AES-256-GCM using `OUTBOX_ENCRYPTION_KEY` (env). The notification consumer decrypts it to build the link. Outbox rows are TTL-deleted after publish.

## 8. Notification templates
Stored as code in `modules/notifications/templates/` (Handlebars or simple TS functions), each with `email.subject`, `email.html`, `email.text`, `sms.text` (≤ 160 chars). Templates: `welcome`, `password_reset`, `booking_confirmed`, `booking_rescheduled`, `booking_cancelled`, `booking_reminder_24h`, `booking_reminder_2h`, `booking_no_show`, `booking_thank_you`, `staff_booking_assigned`, `staff_booking_changed`, `staff_booking_cancelled`.
Providers: `MockEmailProvider` / `MockSmsProvider` (store + log), `SmtpEmailProvider` (nodemailer → Mailpit locally). Interface allows adding SES/SendGrid/Twilio/MSG91 later. The `notifications` row is the stored copy (`payload` = the rendered subject/text/html); values a template marks secret, such as the password-reset link, are replaced with `[redacted]` before storing. Logs never contain the recipient or the content (NFR-009); a provider error is logged by name and code only.

## 9. Tests required
- Booking creation writes booking + audit + outbox in one transaction; aborting leaves none.
- Relay publishes pending events once, marks them published, retries on failure, honours claim.
- Each consumer: processes event; duplicate delivery is a no-op; failure is retried.
- Scheduled jobs pick exactly the right bookings at window boundaries (use fake timers / injected clock).
- Event payload schema validation rejects bad payloads.
