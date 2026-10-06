# 08 — Caching (Redis)

## 1. Principles
- **Cache-aside** pattern: read from cache → on miss, load from Mongo, write to cache with TTL.
- Cache is an **optimisation, never a source of truth**. If Redis is down, the API must still work (reads go to Mongo, a `warn` log is emitted once per minute, readiness stays HTTP 200 with status `degraded` (03 §6) and a `cache_errors_total` metric increments). Only rate limiting and locks degrade in a controlled way (see §5).
- All keys are built by functions in `shared/cache/keys.ts` (no ad-hoc string keys), prefixed with `ss:` and a schema version: `ss:v1:...`. Bumping the version invalidates everything after a breaking change to cached shapes.
- Values are JSON. Max value size 256 KB.
- `CACHE_ENABLED=false` turns the cache layer into a pass-through (used in some tests).

## 2. What is cached

| Data | Key | TTL | Invalidated by |
|---|---|---|---|
| Public settings | `ss:v1:settings:public` | 10 min | `settings.update` |
| Full settings (server use) | `ss:v1:settings:full` | 10 min | `settings.update` |
| Category list | `ss:v1:catalog:categories` | 30 min | any category change |
| Service list (per filter) | `ss:v1:catalog:services:{hash(query)}` | 10 min | any service/category change → delete by tag |
| Service detail | `ss:v1:catalog:service:{id}` | 30 min | that service change, review aggregate change |
| Public staff list | `ss:v1:staff:list:{serviceId|all}` | 10 min | staff/service change → tag |
| Staff profile | `ss:v1:staff:{id}` | 30 min | that staff change, review aggregate change |
| Availability for a day | `ss:v1:avail:{staffId}:{date}:{durationSpan}` | 60 s | booking create/reschedule/cancel/status→CANCELLED/NO_SHOW, time-off change, schedule change, holiday/settings change |
| Available-days calendar | `ss:v1:availdays:{staffId|any}:{servicesHash}:{from}:{to}` | 2 min | same as above (by tag) |
| Dashboard summary | `ss:v1:reports:dashboard:{date}` | 30 s | none (short TTL) |
| Report summary | `ss:v1:reports:summary:{from}:{to}` | 5 min | `daily_stats` updates for dates within range (tag) |
| Idempotency responses | `ss:v1:idem:{userId}:{key}` | 24 h | expiry only |

**Availability granularity:** cache per stylist per date per required span, so "any stylist" requests combine per-stylist cached results. This keeps invalidation precise: a booking for stylist X on date D only clears X/D keys.
Cached slot lists are **independent of the caller and the clock**: they do not apply the lead-time or "not in the past" filters. Those are applied after reading from the cache (03 §5.2 step 5). The same cached entry therefore serves customers and staff, and stays correct for its whole TTL.

## 3. Tag-based invalidation
Since Redis has no native tags, maintain a Redis SET per tag listing keys:
- `cacheAside(key, ttl, loader, { tags: ['catalog'] })` also does `SADD ss:v1:tag:catalog key` (with the tag set TTL ≥ longest member TTL).
- `invalidateTag('catalog')` → `SMEMBERS` → `UNLINK` keys + tag set (pipeline).
- Tag names: `settings`, `catalog`, `staff`, `avail:{staffId}:{date}`, `availdays:{staffId}`, `reports`.

## 4. Where invalidation happens
- **Synchronously after commit** in the service for the instance that made the change (so the user who made the change sees fresh data immediately).
- **Also via event consumer** (`cache-invalidation` worker subscribed to domain events) — guarantees invalidation even if the API crashed between commit and the synchronous call. Both operations are idempotent.

## 5. Other Redis uses
| Use | Key | Behaviour when Redis unavailable |
|---|---|---|
| Rate limiting | `ss:v1:rl:{scope}:{id}` | Fail **open** for global limit (log warn), fail **closed** (429) for login limit |
| Login failure counter | `ss:v1:login_fail:{emailHash}` | Fail closed for login |
| Distributed lock (booking) | `ss:v1:lock:staff:{staffId}:{date}` | Booking creation returns 503 `TEMPORARILY_UNAVAILABLE`. (Overlap is prevented by the transaction plus the staff-day guard document, 02 §2.18. The lock only reduces contention and write-conflict retries. Failing closed keeps behaviour predictable while Redis is down.) |
| BullMQ queues | `bull:*` (BullMQ's own prefix `ss`) | Events stay safely in the outbox until Redis returns |

Lock implementation: `SET key token NX PX 5000`; release with a Lua script that deletes only if the token matches.

## 6. Observability
- Debug log for hit/miss with key prefix (not full key).
- Metrics: `cache_hits_total{prefix}`, `cache_misses_total{prefix}`, `cache_errors_total`.

## 7. Tests required
- Cache-aside: miss loads & stores; hit skips loader.
- Redis failure: loader still called, no exception propagates.
- Booking creation invalidates the exact availability keys (spy on `invalidateTag`).
- Tag invalidation removes all members.
- Lock: second acquirer fails; release with wrong token does nothing.
